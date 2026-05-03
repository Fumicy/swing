// ClubDetector — three-tier club head position estimation
//
// Tier 1: YOLOv8n ONNX (models/club_yolo8n.onnx) — highest precision
// Tier 2: MotionTracker — frame-diff 80×80, works during movement
// Tier 3: PoseEstimator — extends shoulder→wrist arm vector × 1.3
//         Works at ADDRESS (no motion) and as spatial prior for all phases
//
// detect(videoEl, lms, phase) returns the highest-confidence result across
// all available tiers, or null if none exceed CONF_THRESH.

import { getLM } from './utils.js?v=0503-12';

const MODEL_PATH  = 'models/club_yolo8n.onnx';
const INPUT_SIZE  = 320;
const CONF_THRESH = 0.35;

// ─── Tier 3: Pose-based estimator ─────────────────────────────────────────
// Geometry: the club shaft is a continuation of the arm line.
// shoulder_midpoint → wrist_midpoint = arm vector (length L)
// club_head ≈ wrist + arm_unit × (L × 1.3)   (iron ≈ 1.2, driver ≈ 1.4)
//
// Confidence is phase-dependent — highest at ADDRESS where the club
// is static and the geometry is most predictable.
const POSE_CONF = {
  address: 0.52, backswing: 0.43, top: 0.38,
  downswing: 0.37, follow: 0.41, complete: 0.47,
};

class PoseEstimator {
  estimate(lms, phase) {
    const lw = getLM(lms, 15), rw = getLM(lms, 16);
    if (!lw && !rw) return null;

    const ls = getLM(lms, 11), rs = getLM(lms, 12);
    if (!ls || !rs) return null; // shoulders required for angle

    // Grip = wrist centroid (use whichever are visible)
    const wx = lw && rw ? (lw.x + rw.x) / 2 : (lw ?? rw).x;
    const wy = lw && rw ? (lw.y + rw.y) / 2 : (lw ?? rw).y;

    // Arm vector: shoulder midpoint → wrist midpoint
    const sx = (ls.x + rs.x) / 2;
    const sy = (ls.y + rs.y) / 2;
    const dx = wx - sx, dy = wy - sy;
    const armLen = Math.sqrt(dx * dx + dy * dy);
    if (armLen < 0.02) return null;

    // Ground reference from ankles (LM27/28), fall back to fixed value
    const la = getLM(lms, 27), ra = getLM(lms, 28);
    const groundY = la && ra ? (la.y + ra.y) / 2 + 0.01 : 0.92;

    // Club head = wrist + arm_unit × club_shaft_length
    // Ratio 1.3 ≈ avg iron shaft visible from grip to head / arm length
    const ratio = 1.3;
    let chx = wx + (dx / armLen) * armLen * ratio;
    let chy = wy + (dy / armLen) * armLen * ratio;

    // Clamp: cannot go below ground or above hands
    chy = Math.max(wy, Math.min(chy, groundY));
    chx = Math.max(0, Math.min(1, chx));

    const conf = POSE_CONF[phase] ?? 0.38;
    return { x: chx, y: chy, w: 0.04, h: 0.04, conf, cls: 0 };
  }
}

// ─── Tier 2: Motion tracker ────────────────────────────────────────────────
// 80×80 frame-diff, 8×8 block grid. Returns detection-shaped object so the
// rest of the pipeline treats it identically to YOLO output.

const MT_SIZE   = 80;
const MT_BLOCK  = 8;
const MT_THRESH = 8; // mean abs-diff to report a detection (0-255)

class MotionTracker {
  constructor() {
    this._canvas = document.createElement('canvas');
    this._canvas.width = this._canvas.height = MT_SIZE;
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
    this._prev = null;
  }

  detect(videoEl) {
    if (!videoEl.videoWidth) return null;

    const ctx = this._ctx;
    ctx.drawImage(videoEl, 0, 0, MT_SIZE, MT_SIZE);
    const { data } = ctx.getImageData(0, 0, MT_SIZE, MT_SIZE);

    const luma = new Uint8ClampedArray(MT_SIZE * MT_SIZE);
    for (let i = 0; i < luma.length; i++) {
      luma[i] = (data[i*4]*77 + data[i*4+1]*150 + data[i*4+2]*29) >> 8;
    }

    if (!this._prev) { this._prev = luma; return null; }

    const blocks = Math.floor(MT_SIZE / MT_BLOCK);
    let bestMean = 0, bestBx = -1, bestBy = -1;

    for (let by = 0; by < blocks; by++) {
      for (let bx = 0; bx < blocks; bx++) {
        let sum = 0;
        for (let dy = 0; dy < MT_BLOCK; dy++) {
          for (let dx = 0; dx < MT_BLOCK; dx++) {
            const idx = (by * MT_BLOCK + dy) * MT_SIZE + (bx * MT_BLOCK + dx);
            sum += Math.abs(luma[idx] - this._prev[idx]);
          }
        }
        const mean = sum / (MT_BLOCK * MT_BLOCK);
        if (mean > bestMean) { bestMean = mean; bestBx = bx; bestBy = by; }
      }
    }

    this._prev = luma;
    if (bestMean < MT_THRESH) return null;

    const cx = (bestBx + 0.5) / blocks;
    const cy = (bestBy + 0.5) / blocks;
    const hw = 1 / blocks;
    // Map mean-diff 8→0.36, 80→0.65 (stays above CONF_THRESH, below YOLO range)
    const conf = Math.min(0.35 + (bestMean - MT_THRESH) / 100, 0.65);

    return { x: cx, y: cy, w: hw * 2, h: hw * 2, conf, cls: 0 };
  }

  reset() { this._prev = null; }
}

// ─── Tier 1 + orchestration: ClubDetector ─────────────────────────────────

export class ClubDetector {
  constructor() {
    this.session = null;
    this.ready   = false;
    this.loading = false;
    this.error   = null;
    this._canvas = document.createElement('canvas');
    this._canvas.width = this._canvas.height = INPUT_SIZE;
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
    this._motion = new MotionTracker();
    this._pose   = new PoseEstimator();
  }

  async init() {
    if (this.loading || this.ready) return;
    this.loading = true;
    try {
      if (typeof ort === 'undefined') throw new Error('onnxruntime-web が未ロード');
      this.session = await ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      this.ready = true;
    } catch (e) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }

  // Returns best detection { x, y, w, h, conf, cls } (0-1 normalized).
  // lms: MediaPipe pose landmarks (optional, enables Tier 3).
  // phase: current swing phase string (optional, tunes pose confidence).
  async detect(videoEl, lms = null, phase = null) {
    // Tier 1: YOLO — if available, it wins immediately
    if (this.ready && videoEl.videoWidth) {
      try {
        const tensor = this._preprocess(videoEl);
        const out    = await this.session.run({ images: tensor });
        const yolo   = this._postprocess(out.output0, videoEl.videoWidth, videoEl.videoHeight);
        if (yolo) return yolo;
      } catch { /* fall through */ }
    }

    // Tier 2+3: motion tracker and pose estimator run in parallel
    const motionResult = this._motion.detect(videoEl);
    const poseResult   = lms ? this._pose.estimate(lms, phase) : null;

    // Return highest-confidence non-null result
    const candidates = [motionResult, poseResult].filter(Boolean);
    if (!candidates.length) return null;
    return candidates.reduce((a, b) => a.conf >= b.conf ? a : b);
  }

  _preprocess(videoEl) {
    const sz = INPUT_SIZE;
    this._ctx.drawImage(videoEl, 0, 0, sz, sz);
    const { data } = this._ctx.getImageData(0, 0, sz, sz);
    const n = sz * sz;
    const t = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      t[i]       = data[i * 4]     / 255;
      t[n + i]   = data[i * 4 + 1] / 255;
      t[2*n + i] = data[i * 4 + 2] / 255;
    }
    return new ort.Tensor('float32', t, [1, 3, sz, sz]);
  }

  _postprocess(output, origW, origH) {
    const d        = output.data;
    const numBoxes = output.dims[2];
    const nc       = output.dims[1] - 4;

    let bestConf = CONF_THRESH;
    let best     = null;

    for (let i = 0; i < numBoxes; i++) {
      let maxConf = 0, maxCls = 0;
      for (let c = 0; c < nc; c++) {
        const conf = d[(4 + c) * numBoxes + i];
        if (conf > maxConf) { maxConf = conf; maxCls = c; }
      }
      if (maxConf > bestConf) {
        bestConf = maxConf;
        const sz = INPUT_SIZE;
        best = {
          x: d[0 * numBoxes + i] / sz,
          y: d[1 * numBoxes + i] / sz,
          w: d[2 * numBoxes + i] / sz,
          h: d[3 * numBoxes + i] / sz,
          cls:  maxCls,
          conf: maxConf,
        };
      }
    }
    return best;
  }

  reset() {
    this._motion.reset();
  }

  get statusText() {
    if (this.loading) return 'クラブ検出: 読み込み中...';
    if (this.ready)   return 'クラブ検出: YOLO稼働中';
    if (this.error)   return 'クラブ検出: モーション+姿勢推定';
    return 'クラブ検出: 未初期化';
  }
}
