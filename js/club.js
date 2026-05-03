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

const MODEL_PATH  = 'models/club_yolo8n.onnx';
const INPUT_SIZE  = 320;
const CONF_THRESH = 0.35;

export class ClubDetector {
  constructor() {
    this.session = null;
    this.ready   = false;
    this.loading = false;
    this.error   = null;
    this._canvas = document.createElement('canvas');
    this._canvas.width = this._canvas.height = INPUT_SIZE;
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
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
    if (!this.ready || !videoEl.videoWidth) return null;
    try {
      const tensor = this._preprocess(videoEl);
      const feeds  = { images: tensor };
      const out    = await this.session.run(feeds);
      return this._postprocess(out.output0, videoEl.videoWidth, videoEl.videoHeight);
    } catch {
      return null;
    }
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

  get statusText() {
    if (this.loading) return 'クラブ検出: 読み込み中...';
    if (this.ready)   return 'クラブ検出: 稼働中';
    if (this.error)   return `クラブ検出: ${this.error.slice(0, 40)}`;
    return 'クラブ検出: 未初期化';
  }
}
