// ClubDetector — YOLOv8n inference via onnxruntime-web (WASM backend)
//
// Expected model: models/club_yolo8n.onnx
//   Input  : "images"  [1, 3, 320, 320]  float32, RGB, 0-1
//   Output : "output0" [1, 4+nc, 2100]   float32
//            Row layout per box: cx, cy, w, h (in model-pixel coords), cls0…clsN
//
// Train:  yolo train data=golf.yaml model=yolov8n.pt imgsz=320 epochs=50
// Export: yolo export model=best.pt  format=onnx imgsz=320 simplify=True opset=12
//
// Class mapping (adjust to match your training labels):
//   0 = club_head
//
// Fallback: when model is unavailable, MotionTracker uses frame-difference
// on an 80×80 downscale to locate the fastest-moving region each frame.

const MODEL_PATH  = 'models/club_yolo8n.onnx';
const INPUT_SIZE  = 320;
const CONF_THRESH = 0.35;

// ─── Motion-based tracker (no model required) ──────────────────────────────
// Downscales to 80×80, computes absolute frame diff, finds the block with
// the highest motion energy. Returns a detection-shaped object so the rest
// of the pipeline treats it the same as a YOLO result.

const MT_SIZE   = 80;   // downscale resolution
const MT_BLOCK  = 8;    // NMS block size (8×8 → 10×10 grid)
const MT_THRESH = 12;   // mean abs-diff to report a detection (0-255)

class MotionTracker {
  constructor() {
    this._canvas  = document.createElement('canvas');
    this._canvas.width = this._canvas.height = MT_SIZE;
    this._ctx     = this._canvas.getContext('2d', { willReadFrequently: true });
    this._prev    = null; // Uint8ClampedArray of previous luma frame
  }

  // videoEl → { x, y, w, h, conf, cls } or null
  detect(videoEl) {
    if (!videoEl.videoWidth) return null;

    const ctx = this._ctx;
    ctx.drawImage(videoEl, 0, 0, MT_SIZE, MT_SIZE);
    const { data } = ctx.getImageData(0, 0, MT_SIZE, MT_SIZE);

    // Convert to luma (R*0.299 + G*0.587 + B*0.114)
    const luma = new Uint8ClampedArray(MT_SIZE * MT_SIZE);
    for (let i = 0; i < luma.length; i++) {
      luma[i] = (data[i*4]*77 + data[i*4+1]*150 + data[i*4+2]*29) >> 8;
    }

    if (!this._prev) { this._prev = luma; return null; }

    const blocks = Math.floor(MT_SIZE / MT_BLOCK); // 10
    let bestSum = 0, bestBx = -1, bestBy = -1;

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
        if (mean > bestSum) { bestSum = mean; bestBx = bx; bestBy = by; }
      }
    }

    this._prev = luma;

    if (bestSum < MT_THRESH) return null;

    // Convert block position to 0-1 normalized coords
    const cx = (bestBx + 0.5) / blocks;
    const cy = (bestBy + 0.5) / blocks;
    const hw = 1 / blocks; // half-width ~= one block
    const conf = Math.min(bestSum / 80, 0.65); // cap at 0.65 so YOLO takes priority

    return { x: cx, y: cy, w: hw * 2, h: hw * 2, conf, cls: 0 };
  }

  reset() { this._prev = null; }
}

// ─── Main detector ─────────────────────────────────────────────────────────

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
  }

  // Call once. Resolves when model is ready (or on error — check this.error).
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

  // Returns best detection { x, y, w, h, conf, cls } (0-1 normalized to video size)
  // or null if nothing detected / model not ready.
  async detect(videoEl) {
    if (this.ready) {
      if (!videoEl.videoWidth) return null;
      try {
        const tensor = this._preprocess(videoEl);
        const feeds  = { images: tensor };
        const out    = await this.session.run(feeds);
        const result = this._postprocess(out.output0, videoEl.videoWidth, videoEl.videoHeight);
        if (result) return result;
        // Fall through to motion tracker if YOLO found nothing
      } catch { /* fall through */ }
    }
    // Fallback: motion-based tracking
    return this._motion.detect(videoEl);
  }

  _preprocess(videoEl) {
    const sz = INPUT_SIZE;
    this._ctx.drawImage(videoEl, 0, 0, sz, sz);
    const { data } = this._ctx.getImageData(0, 0, sz, sz);
    const n = sz * sz;
    const t = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      t[i]       = data[i * 4]     / 255; // R
      t[n + i]   = data[i * 4 + 1] / 255; // G
      t[2*n + i] = data[i * 4 + 2] / 255; // B
    }
    return new ort.Tensor('float32', t, [1, 3, sz, sz]);
  }

  // YOLOv8 ONNX output: [1, 4+nc, numBoxes]
  // No NMS — just return the single highest-confidence box.
  _postprocess(output, origW, origH) {
    const d        = output.data;
    const numBoxes = output.dims[2];  // last dim
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
          x:    d[0 * numBoxes + i] / sz, // cx normalized
          y:    d[1 * numBoxes + i] / sz, // cy normalized
          w:    d[2 * numBoxes + i] / sz,
          h:    d[3 * numBoxes + i] / sz,
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
    if (this.error)   return 'クラブ検出: モーション追跡（フォールバック）';
    return 'クラブ検出: 未初期化';
  }
}
