// ClubDetector — club head position estimation (display only, not used for phase detection)
//
// Three-tier pipeline, best-confidence result wins:
//
// Tier 1  YOLO (models/club_yolo8n.onnx) — highest precision when model available
// Tier 2  ShaftDiffTracker               — body-masked frame diff + shaft line verify
// Tier 3  IK extension                   — forearm extension, self-calibrated at address

import { getLM } from './utils.js?v=0503-14';

const MODEL_PATH  = 'models/club_yolo8n.onnx';
const INPUT_SIZE  = 320;
const CONF_THRESH = 0.35;

// ─── Tier 2: Shaft-line diff tracker ──────────────────────────────────────
//
// Algorithm per frame:
//  1. Compute luma frame diff at SD_SIZE × SD_SIZE
//  2. Zero-out pixels near each body landmark (body motion suppression)
//  3. Find global diff peak → club head candidate
//  4. Sample along the grip→candidate line; if ≥25% of samples are "hot"
//     the shaft is confirmed and the detection is returned
//
// Body mask indices: key joints that move visibly during a swing.
// Using raw landmark access (visibility ≥ 0.2) so even partially-seen
// joints are masked — we want to suppress body, not detect it.

const SD_SIZE   = 80;
const SD_THRESH = 10;  // minimum diff value to count as "active" (0-255)
const SD_MASK_R = 6;   // body-mask radius in pixels at SD_SIZE resolution
const BODY_IDX  = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

class ShaftDiffTracker {
  constructor() {
    this._canvas = document.createElement('canvas');
    this._canvas.width = this._canvas.height = SD_SIZE;
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
    this._prev = null;
  }

  detect(videoEl, lms) {
    if (!videoEl.videoWidth) return null;
    const sz = SD_SIZE;
    this._ctx.drawImage(videoEl, 0, 0, sz, sz);
    const { data } = this._ctx.getImageData(0, 0, sz, sz);

    // Luma
    const luma = new Uint8ClampedArray(sz * sz);
    for (let i = 0; i < sz * sz; i++) {
      luma[i] = (data[i*4]*77 + data[i*4+1]*150 + data[i*4+2]*29) >> 8;
    }
    if (!this._prev) { this._prev = luma; return null; }

    // Absolute diff
    const diff = new Float32Array(sz * sz);
    for (let i = 0; i < sz * sz; i++) {
      diff[i] = Math.abs(luma[i] - this._prev[i]);
    }
    this._prev = luma;

    // Body mask: suppress landmarks ± SD_MASK_R pixels
    if (lms) {
      const r2 = SD_MASK_R * SD_MASK_R;
      for (const idx of BODY_IDX) {
        const lm = lms[idx];
        if (!lm || (lm.visibility ?? 0) < 0.2) continue;
        const px = Math.round(lm.x * sz);
        const py = Math.round(lm.y * sz);
        for (let dy = -SD_MASK_R; dy <= SD_MASK_R; dy++) {
          for (let dx = -SD_MASK_R; dx <= SD_MASK_R; dx++) {
            if (dx*dx + dy*dy > r2) continue;
            const nx = px + dx, ny = py + dy;
            if (nx >= 0 && nx < sz && ny >= 0 && ny < sz)
              diff[ny * sz + nx] = 0;
          }
        }
      }
    }

    // Global max after masking
    let bestVal = 0, bi = 0;
    for (let i = 0; i < sz * sz; i++) {
      if (diff[i] > bestVal) { bestVal = diff[i]; bi = i; }
    }
    if (bestVal < SD_THRESH) return null;

    const headPx = bi % sz;
    const headPy = Math.floor(bi / sz);

    // Shaft line verification (requires wrist landmarks for grip position)
    if (lms) {
      const lw = lms[15], rw = lms[16];
      const wristOk = (lw && (lw.visibility ?? 0) >= 0.3) ||
                      (rw && (rw.visibility ?? 0) >= 0.3);
      if (wristOk) {
        const nw = (lw ? 1 : 0) + (rw ? 1 : 0);
        const gripX = ((lw?.x ?? 0) + (rw?.x ?? 0)) / nw * sz;
        const gripY = ((lw?.y ?? 0) + (rw?.y ?? 0)) / nw * sz;
        const lineLen = Math.sqrt((headPx - gripX) ** 2 + (headPy - gripY) ** 2);

        if (lineLen > 4) {
          let active = 0, total = 0;
          // Sample from 30% along the line (skip the grip region) to the head
          for (let t = 0.30; t < 1.0; t += 2 / lineLen) {
            const sx = Math.round(gripX + (headPx - gripX) * t);
            const sy = Math.round(gripY + (headPy - gripY) * t);
            if (sx < 0 || sx >= sz || sy < 0 || sy >= sz) continue;
            if (diff[sy * sz + sx] > SD_THRESH * 0.4) active++;
            total++;
          }
          if (total > 0 && active / total < 0.25) return null; // shaft not confirmed
        }
      }
    }

    const conf = Math.min(0.42 + bestVal / 80, 0.70);
    return { x: headPx / sz, y: headPy / sz, w: 0.04, h: 0.04, conf, cls: 0 };
  }

  reset() { this._prev = null; }
}

// ─── Tier 3: IK extension (forearm bone extended to club head) ─────────────
//
// Self-calibration at ADDRESS:
//   Solve forearm unit-vector projected to ankle level → club length ratio.
//   Averages 5 frames; after calibration conf=0.58 > motion tracker at rest.
//   Pre-calibration uses DEFAULT_CLUB_RATIO as a reasonable prior.

const DEFAULT_CLUB_RATIO = 1.5;

class IKExtension {
  constructor() {
    this._ratio = null;
    this._accR  = 0;
    this._accN  = 0;
  }

  calibrate(lms) {
    const lw = getLM(lms, 15), rw = getLM(lms, 16);
    const le = getLM(lms, 13), re = getLM(lms, 14);
    const la = getLM(lms, 27), ra = getLM(lms, 28);
    if (!lw || !rw || !le || !re || !la || !ra) return;

    const wx = (lw.x + rw.x) / 2, wy = (lw.y + rw.y) / 2;
    const ex = (le.x + re.x) / 2, ey = (le.y + re.y) / 2;
    const groundY = (la.y + ra.y) / 2;

    const dy = wy - ey;
    if (dy < 0.03) return; // forearm not pointing downward — not address posture

    const L = Math.sqrt((wx - ex) ** 2 + (wy - ey) ** 2);
    if (L < 0.01) return;

    // Club head is where the forearm ray intersects ground level
    // R = (groundY - wy) * L / dy
    const ratio = (groundY - wy) * L / dy / L;
    if (ratio < 0.8 || ratio > 3.0) return;

    this._accR += ratio;
    this._accN++;
    if (this._accN >= 5) this._ratio = this._accR / this._accN;
  }

  estimate(lms) {
    const lw = getLM(lms, 15), rw = getLM(lms, 16);
    const le = getLM(lms, 13), re = getLM(lms, 14);
    if ((!lw && !rw) || (!le && !re)) return null;

    const wx = lw && rw ? (lw.x + rw.x) / 2 : (lw ?? rw).x;
    const wy = lw && rw ? (lw.y + rw.y) / 2 : (lw ?? rw).y;
    const ex = le && re ? (le.x + re.x) / 2 : (le ?? re).x;
    const ey = le && re ? (le.y + re.y) / 2 : (le ?? re).y;

    const dx = wx - ex, dy = wy - ey;
    const L = Math.sqrt(dx * dx + dy * dy);
    if (L < 0.01) return null;

    const ratio = this._ratio ?? DEFAULT_CLUB_RATIO;
    const chx = Math.max(0, Math.min(1, wx + (dx / L) * L * ratio));
    const chy = wy + (dy / L) * L * ratio;

    const la = getLM(lms, 27), ra = getLM(lms, 28);
    const groundY = la && ra ? (la.y + ra.y) / 2 : 0.92;
    const cy = Math.max(wy, Math.min(chy, groundY + 0.02));

    const conf = this._ratio !== null ? 0.58 : 0.38;
    return { x: chx, y: cy, w: 0.04, h: 0.04, conf, cls: 0 };
  }

  reset() { this._ratio = null; this._accR = 0; this._accN = 0; }
}

// ─── ClubDetector (orchestrator) ──────────────────────────────────────────

export class ClubDetector {
  constructor() {
    this.session = null;
    this.ready   = false;
    this.loading = false;
    this.error   = null;
    this._canvas = document.createElement('canvas');
    this._canvas.width = this._canvas.height = INPUT_SIZE;
    this._ctx    = this._canvas.getContext('2d', { willReadFrequently: true });
    this._shaft  = new ShaftDiffTracker();
    this._ik     = new IKExtension();
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

  async detect(videoEl, lms = null, phase = null) {
    // IK calibration runs every address frame
    if (lms && phase === 'address') this._ik.calibrate(lms);

    // Tier 1: YOLO
    if (this.ready && videoEl.videoWidth) {
      try {
        const tensor = this._preprocess(videoEl);
        const out    = await this.session.run({ images: tensor });
        const yolo   = this._postprocess(out.output0);
        if (yolo) return yolo;
      } catch { /* fall through */ }
    }

    // Tier 2: shaft diff tracker (body-masked diff + shaft line verify)
    const shaftResult = this._shaft.detect(videoEl, lms);

    // Tier 3: IK extension (works at rest; yields to tier 2 when swinging)
    const ikResult = lms ? this._ik.estimate(lms) : null;

    const candidates = [shaftResult, ikResult].filter(Boolean);
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

  _postprocess(output) {
    const d        = output.data;
    const numBoxes = output.dims[2];
    const nc       = output.dims[1] - 4;
    let bestConf = CONF_THRESH, best = null;
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
          x: d[0 * numBoxes + i] / sz, y: d[1 * numBoxes + i] / sz,
          w: d[2 * numBoxes + i] / sz, h: d[3 * numBoxes + i] / sz,
          cls: maxCls, conf: maxConf,
        };
      }
    }
    return best;
  }

  reset() {
    this._shaft.reset();
    this._ik.reset();
  }

  get statusText() {
    if (this.loading) return 'クラブ検出: 読み込み中...';
    if (this.ready)   return 'クラブ検出: YOLO稼働中';
    if (this.error)   return 'クラブ検出: シャフト差分+IK';
    return 'クラブ検出: 未初期化';
  }
}
