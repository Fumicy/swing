import { PhaseDetector } from './phase.js?v=0503-8';
import { SwingAnalyzer }  from './analyzer.js?v=0503-8';
import { Renderer }       from './renderer.js?v=0503-8';
import {
  PHASE, STATUS, ADVICE, TAGS, TAG_PRIORITY, PHASE_LABELS, VERSION
} from './config.js?v=0503-8';

// ── App State ─────────────────────────────────────────────────────────────────
const AppState = {
  SETUP:      'setup',
  FRAMING:    'framing',
  COUNTDOWN:  'countdown',
  RECORDING:  'recording',
  ANALYZING:  'analyzing',
  RESULTS:    'results',
};

// ── Swing buffer entry ─────────────────────────────────────────────────────────
// { landmarks, phase, imageUrl, frameData }

class App {
  constructor() {
    this.state        = AppState.SETUP;
    this.concern      = 'general';
    this.angle        = 'front';
    this.delay        = 5;

    this.stream       = null;
    this.pose         = null;
    this.renderer     = null;
    this._previewActive  = false;
    this.facingMode      = 'environment';
    this.latestLms       = null;
    this.latestFrameData = null;
    this.phaseDetector = new PhaseDetector();
    this.analyzer     = new SwingAnalyzer();

    this.swingBuffer  = [];         // stored frames
    this.phaseSnaps   = {};         // { phase: imageUrl }
    this.results      = null;
    this.activePhase  = PHASE.ADDRESS;

    this.rafId        = null;
    this.mpMs         = 0;
    this.frameCount   = 0;
    this.analyzeCount = 0;
    this.lastFpsTime  = 0;
    this.camFps       = 0;
    this.anFps        = 0;
    this.lastAnalyzeTime = 0;
    this.cdTimer      = null;
    this.cdValue      = 5;

    this.swingDetected = false;
    this.referenceCollected = false;
    this.refFrameCount = 0;

    // Results viewer state
    this.viewPhase    = PHASE.ADDRESS;
    this.viewFrame    = 0;

    this._bind();
    this._initUI();
  }

  // ── Setup screen ──────────────────────────────────────────────────────────

  _initUI() {
    // Version badge
    document.querySelectorAll('.hdr-sub').forEach(el => {
      el.textContent += `  v${VERSION}`;
    });

    // Concern tags
    const tagGrid = document.getElementById('tag-grid');
    TAGS.forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'tag-btn' + (t.id === 'general' ? ' active' : '');
      btn.textContent = t.label;
      btn.dataset.tag = t.id;
      btn.onclick = () => {
        document.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.concern = t.id;
      };
      tagGrid.appendChild(btn);
    });

    // Angle
    document.querySelectorAll('.angle-btn').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('.angle-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.angle = b.dataset.angle;
      };
    });

    // Delay
    document.querySelectorAll('.delay-btn').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('.delay-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.delay = parseInt(b.dataset.delay);
      };
    });

    document.getElementById('btn-to-camera').onclick  = () => this._startCamera();
    document.getElementById('btn-retry').onclick      = () => this._reset();
    document.getElementById('btn-another').onclick    = () => this._goToRecording();
    document.getElementById('btn-flip-cam').onclick   = () => this._flipCamera();
    document.getElementById('btn-cancel-rec').onclick = () => {
      if (this.cdTimer) { clearInterval(this.cdTimer); this.cdTimer = null; }
      document.getElementById('countdown-num').style.display = 'none';
      this.analyzer.reset();
      this.phaseDetector.reset();
      this.swingBuffer = [];
      this.phaseSnaps  = {};
      this.swingDetected = false;
      this.referenceCollected = false;
      this.refFrameCount = 0;
      this._showScreen('framing');
    };

    // Results filter
    const fsel = document.getElementById('filter-sel');
    TAGS.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id; opt.textContent = t.label;
      fsel.appendChild(opt);
    });
    fsel.onchange = () => this._renderResults(fsel.value);

    // Phase thumbnails click
    document.querySelectorAll('.phase-thumb').forEach(t => {
      t.onclick = () => {
        const ph = t.dataset.phase;
        if (this.phaseSnaps[ph]) this._showPhaseFrame(ph);
      };
    });

    // Scrubber
    document.getElementById('scrubber').oninput = (e) => {
      this.viewFrame = parseInt(e.target.value);
      this._updateScrubberFrame();
    };
  }

  _bind() {
    // nothing extra for now
  }

  // ── Camera & MediaPipe ────────────────────────────────────────────────────

  async _startCamera() {
    this._showScreen('framing');
    const vid    = document.getElementById('vid');
    const cvs    = document.getElementById('overlay');
    const banner = document.getElementById('frame-banner');
    this.renderer = new Renderer(cvs);

    try {
      banner.textContent = 'カメラを起動中...';
      banner.style.color = '#8b949e';
      document.getElementById('btn-frame-ok').disabled = true;

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: this.facingMode },
          frameRate:  { ideal: 30 },
          width:      { ideal: 1280 },
          height:     { ideal: 720 },
        },
        audio: false,
      });
      vid.srcObject = this.stream;
      await vid.play();

      const s = this.stream.getVideoTracks()[0].getSettings();
      this.camFps = s.frameRate || 30;
      document.getElementById('cam-info').textContent =
        `${s.width ?? '?'}×${s.height ?? '?'} @ ${Math.round(this.camFps)}fps`;

      // Show camera preview immediately — before MediaPipe is ready
      this._startPreviewLoop(vid);

      banner.textContent = '解析エンジンを読み込み中... (初回は10〜30秒かかります)';
      banner.style.color = '#e3b341';

      await this._initPose();

      // Hand off from preview loop to full analysis loop
      this._previewActive = false;
      this._startLoop();

    } catch(e) {
      const msg =
        e.name === 'NotAllowedError' ? 'カメラへのアクセスが拒否されました。\nブラウザの設定でカメラを許可してください。' :
        e.name === 'NotFoundError'   ? 'カメラが見つかりません。' :
        `カメラエラー (${e.name}): ${e.message}`;
      alert(msg);
      this._previewActive = false;
      this._showScreen('setup');
    }
  }

  _startPreviewLoop(vid) {
    this._previewActive = true;
    const loop = () => {
      if (!this._previewActive || !this.stream) return;
      if (vid.videoWidth) {
        this.renderer.resize(vid.videoWidth, vid.videoHeight);
        this.renderer.ctx.drawImage(vid, 0, 0, vid.videoWidth, vid.videoHeight);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  async _flipCamera() {
    if (!this.stream) return;
    this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
    this.stream.getTracks().forEach(t => t.stop());
    const vid = document.getElementById('vid');
    const btn = document.getElementById('btn-flip-cam');
    if (btn) btn.disabled = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: this.facingMode },
          frameRate:  { ideal: 30 },
          width:      { ideal: 1280 },
          height:     { ideal: 720 },
        },
        audio: false,
      });
      vid.srcObject = this.stream;
      await vid.play();
      const s = this.stream.getVideoTracks()[0].getSettings();
      this.camFps = s.frameRate || 30;
      document.getElementById('cam-info').textContent =
        `${s.width ?? '?'}×${s.height ?? '?'} @ ${Math.round(this.camFps)}fps`;
      this.latestLms = null;
      this.latestFrameData = null;
    } catch(e) {
      alert('カメラ切替エラー: ' + e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  _initPose() {
    return new Promise((resolve, reject) => {
      if (typeof Pose === 'undefined') {
        reject(new Error('MediaPipe Pose が読み込まれていません'));
        return;
      }
      this.pose = new Pose({
        locateFile: f =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${f}`
      });
      this.pose.setOptions({
        modelComplexity: 1, smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      this.pose.onResults(r => this._onPoseResults(r));
      this.pose.initialize().then(resolve).catch(reject);
    });
  }

  _startLoop() {
    this.rafId = requestAnimationFrame(ts => this._loop(ts));
  }

  _loop(ts) {
    this.rafId = requestAnimationFrame(ts2 => this._loop(ts2));
    const vid = document.getElementById('vid');
    if (!vid.videoWidth) return;

    const W = vid.videoWidth, H = vid.videoHeight;
    this.renderer.resize(W, H);
    const ctx = this.renderer.ctx;

    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      this.anFps = this.analyzeCount;
      this.analyzeCount = 0;
      this.lastFpsTime = now;
    }

    // Always draw current video frame every RAF tick (prevents flicker)
    ctx.drawImage(vid, 0, 0, W, H);

    // Overlay latest MediaPipe results
    const lms = this.latestLms;
    if (lms) {
      this.renderer.drawSkeleton(lms, this.latestFrameData);
      if (this.state === AppState.RECORDING && this.latestFrameData) {
        this.renderer.drawHeadIndicator(lms, this.latestFrameData.p1);
        this.renderer.drawHipIndicator(lms, this.latestFrameData.p2);
      }
      if (this.state === AppState.RECORDING) {
        this.renderer.drawPhaseLabel(this.activePhase);
        this.renderer.drawRecordingDot();
        if (this.swingDetected) this.renderer.drawSwingDetected();
      }
      if (this.state === AppState.FRAMING) {
        this._updateFramingUI(lms);
      }
    }

    this.renderer.drawFrameBudget(this.mpMs, this.mpMs);
    this._updatePerfDisplay();

    // Throttle MediaPipe to 30fps
    if (now - this.lastAnalyzeTime >= 33) {
      this.lastAnalyzeTime = now;
      this.analyzeCount++;
      const t0 = performance.now();
      this.pose.send({ image: vid }).catch(() => {});
      this.mpMs = performance.now() - t0;
    }
  }

  _onPoseResults(results) {
    const lms = results.poseLandmarks;
    this.latestLms = lms || null;
    if (lms && this.state === AppState.RECORDING) {
      this.latestFrameData = this._processFrame(lms);
    } else {
      this.latestFrameData = null;
    }
  }

  // ── Framing ───────────────────────────────────────────────────────────────

  _updateFramingUI(lms) {
    // Simple: check if key landmarks are visible
    const visible = [11,12,23,24,15,16].every(i =>
      (lms[i]?.visibility ?? 0) > 0.5
    );
    const banner = document.getElementById('frame-banner');
    const startBtn = document.getElementById('btn-frame-ok');

    if (visible) {
      banner.textContent = '✓ フレーミングOK';
      banner.style.color = '#56d364';
      startBtn.disabled = false;
      startBtn.onclick = () => this._startCountdown();
    } else {
      banner.textContent = '人物が映るよう調整してください';
      banner.style.color = '#e3b341';
      startBtn.disabled = true;
    }
  }

  // ── Countdown & Recording ─────────────────────────────────────────────────

  _startCountdown() {
    this._showScreen('recording');
    document.getElementById('rec-status').textContent = '待機中...';
    this.cdValue = this.delay;
    this._showCountdown(this.cdValue);
    this.cdTimer = setInterval(() => {
      this.cdValue--;
      if (this.cdValue <= 0) {
        clearInterval(this.cdTimer);
        this._startRecording();
      } else {
        this._showCountdown(this.cdValue);
      }
    }, 1000);
  }

  _showCountdown(n) {
    const el = document.getElementById('countdown-num');
    el.textContent = n;
    el.style.display = 'block';
  }

  _startRecording() {
    document.getElementById('countdown-num').style.display = 'none';
    document.getElementById('rec-status').textContent = 'スイング待機中...';

    this.swingBuffer = [];
    this.phaseSnaps  = {};
    this.swingDetected = false;
    this.referenceCollected = false;
    this.refFrameCount = 0;
    this.activePhase = PHASE.ADDRESS;

    this.analyzer.reset();
    this.phaseDetector.reset();
    this.phaseDetector.onPhaseChange = (p, prev) => this._onPhaseChange(p, prev);

    this.state = AppState.RECORDING;
  }

  _processFrame(lms) {
    const phase = this.phaseDetector.update(lms);
    this.activePhase = phase;

    // Collect reference during address
    if (!this.referenceCollected) {
      if (this.refFrameCount < 10) {
        this.analyzer.feedReference(lms);
        this.refFrameCount++;
      } else {
        this.referenceCollected = true;
      }
    }

    // Run analysis
    let frameData = null;
    if (this.referenceCollected && this.analyzer.hasRef) {
      frameData = this.analyzer.update(lms, phase);
    }

    // Store frame
    const imageUrl = this._captureFrame();
    this.swingBuffer.push({ lms, phase, imageUrl, frameData });

    // Swing started
    if (phase !== PHASE.ADDRESS && !this.swingDetected) {
      this.swingDetected = true;
      document.getElementById('rec-status').textContent = 'スイング検知 ✓';
    }

    // Swing complete
    if (phase === PHASE.COMPLETE) {
      setTimeout(() => this._finishRecording(), 500);
    }

    return frameData;
  }

  _captureFrame() {
    const cvs = document.getElementById('overlay');
    try { return cvs.toDataURL('image/jpeg', 0.5); } catch { return null; }
  }

  _onPhaseChange(newPhase, prevPhase) {
    // Capture snapshot at phase transition
    const url = this._captureFrame();
    if (url) this.phaseSnaps[prevPhase] = url;
    document.getElementById('rec-status').textContent =
      `${PHASE_LABELS[newPhase] || newPhase} フェーズ`;
  }

  _finishRecording() {
    if (this.state !== AppState.RECORDING) return;
    this.state = AppState.ANALYZING;

    // Capture follow snapshot
    const followUrl = this._captureFrame();
    if (followUrl) this.phaseSnaps[PHASE.FOLLOW] = followUrl;

    this.results = this.analyzer.getResults();
    this._buildResults();
    this._showScreen('results');
  }

  // ── Results ───────────────────────────────────────────────────────────────

  _buildResults() {
    // Populate phase thumbnails
    const PHASES = [PHASE.ADDRESS, PHASE.BACKSWING, PHASE.TOP, PHASE.DOWNSWING, PHASE.FOLLOW];
    PHASES.forEach((ph, i) => {
      const thumb = document.querySelector(`.phase-thumb[data-phase="${ph}"]`);
      if (!thumb) return;
      const snap = this.phaseSnaps[ph];
      if (snap) {
        const img = thumb.querySelector('.thumb-img');
        if (img) { img.src = snap; img.style.display = 'block'; }
      }
      // Status dot
      const dot = thumb.querySelector('.thumb-dot');
      if (dot) {
        const frames = this.swingBuffer.filter(f => f.phase === ph);
        const worst = this._worstStatusForPhase(frames);
        dot.style.background = { ok:'#22c55e', warn:'#f59e0b', problem:'#ef4444', unknown:'#555' }[worst];
      }
    });

    // Scrubber
    const scrubber = document.getElementById('scrubber');
    scrubber.max = Math.max(0, this.swingBuffer.length - 1);
    scrubber.value = 0;

    // Show first phase
    const firstSnap = this.phaseSnaps[PHASE.ADDRESS]
      || this.phaseSnaps[PHASE.BACKSWING]
      || Object.values(this.phaseSnaps)[0];
    if (firstSnap) this._showImageInViewer(firstSnap, 0);

    this._renderResults(this.concern);
  }

  _worstStatusForPhase(frames) {
    const rank = { ok:0, warn:1, problem:2, unknown:-1 };
    let worst = STATUS.UNKNOWN;
    frames.forEach(f => {
      ['p1','p2','p3','p4','p6'].forEach(k => {
        const s = f.frameData?.[k]?.status;
        if (s && (rank[s] ?? -1) > (rank[worst] ?? -1)) worst = s;
      });
    });
    return worst;
  }

  _showPhaseFrame(phase) {
    this.viewPhase = phase;
    document.querySelectorAll('.phase-thumb').forEach(t => {
      t.classList.toggle('active', t.dataset.phase === phase);
    });
    const snap = this.phaseSnaps[phase];
    // Find representative frame index
    const idx = this.swingBuffer.findIndex(f => f.phase === phase);
    this._showImageInViewer(snap, Math.max(0, idx));
  }

  _showImageInViewer(imageUrl, frameIdx) {
    if (!imageUrl) return;
    const cvs = document.getElementById('result-canvas');
    const ctx = cvs.getContext('2d');
    const img = new Image();
    img.onload = () => {
      cvs.width = img.naturalWidth || cvs.parentElement.clientWidth;
      cvs.height = img.naturalHeight || 280;
      ctx.drawImage(img, 0, 0, cvs.width, cvs.height);

      // Draw skeleton overlay if we have landmarks
      if (this.swingBuffer[frameIdx]) {
        const frame = this.swingBuffer[frameIdx];
        if (frame.lms) {
          const r = new Renderer(cvs);
          r.drawSkeleton(frame.lms, frame.frameData);
          if (frame.frameData) {
            r.drawHeadIndicator(frame.lms, frame.frameData.p1);
            r.drawHipIndicator(frame.lms, frame.frameData.p2);
          }
        }
      }
    };
    img.src = imageUrl;
    document.getElementById('scrubber').value = frameIdx;
    this.viewFrame = frameIdx;
    const fn = document.getElementById('viewer-frame-num');
    if (fn && this.swingBuffer.length) fn.textContent = `${frameIdx + 1}/${this.swingBuffer.length}`;
  }

  _updateScrubberFrame() {
    const idx = this.viewFrame;
    const frame = this.swingBuffer[idx];
    if (!frame || !frame.imageUrl) return;
    this._showImageInViewer(frame.imageUrl, idx);
    const pl = document.getElementById('viewer-phase-label');
    if (pl) pl.textContent = PHASE_LABELS[frame.phase] || frame.phase;
    const fn = document.getElementById('viewer-frame-num');
    if (fn) fn.textContent = `${idx + 1}/${this.swingBuffer.length}`;
  }

  _renderResults(concernId) {
    if (!this.results) return;
    document.getElementById('filter-sel').value = concernId;

    const priority = TAG_PRIORITY[concernId] || TAG_PRIORITY.general;
    const R = this.results;

    // Find primary problem
    let primaryKey = null;
    for (const k of priority) {
      const st = R[k]?.status;
      if (st === STATUS.PROBLEM || st === STATUS.WARN) {
        if (!primaryKey || (st === STATUS.PROBLEM)) primaryKey = k;
      }
    }
    if (!primaryKey) primaryKey = priority[0];

    // Primary feedback card
    const adv = ADVICE[primaryKey];
    if (adv) {
      const status = R[primaryKey]?.status || STATUS.UNKNOWN;
      document.getElementById('prim-label').textContent  = adv.label;
      document.getElementById('prim-problem').textContent = adv[status] || adv.problem;
      document.getElementById('prim-hint').textContent   = adv.hint;
      document.getElementById('prim-status').textContent = statusLabel(status);
      document.getElementById('prim-status').className   = 'status-chip ' + status;
    }

    // All principle chips
    const chipContainer = document.getElementById('principle-chips');
    chipContainer.innerHTML = '';
    ['P1','P2','P3','P4','P6','P9'].forEach(k => {
      const st  = R[k]?.status || STATUS.UNKNOWN;
      const adv = ADVICE[k];
      const chip = document.createElement('div');
      chip.className = 'p-chip ' + st;
      chip.innerHTML = `<span class="p-chip-label">${adv.label}</span>
        <span class="p-chip-status">${statusLabel(st)}</span>`;
      chip.onclick = () => {
        document.getElementById('prim-label').textContent   = adv.label;
        document.getElementById('prim-problem').textContent = adv[st] || adv.problem;
        document.getElementById('prim-hint').textContent    = adv.hint;
        document.getElementById('prim-status').textContent  = statusLabel(st);
        document.getElementById('prim-status').className    = 'status-chip ' + st;
      };
      chipContainer.appendChild(chip);
    });

    // Detail numbers
    const det = document.getElementById('result-detail');
    det.innerHTML = '';
    const rows = [
      ['P1 頭部移動（最大）', R.P1 ? `Δx ${(R.P1.peakX*100).toFixed(0)}%  Δy ${(R.P1.peakY*100).toFixed(0)}%（肩幅比）` : '—'],
      ['P2 ラテラルスウェイ（最大）', R.P2 ? `${(R.P2.maxSway*100).toFixed(0)}%（肩幅比）` : '—'],
      ['P3 脊柱角度変化（最大）', R.P3 ? `${R.P3.peakDelta.toFixed(1)}°${R.P3.earlyExt?' ⚠ アーリーエクステンション検知':''}` : '—'],
      ['P4 X-ファクター（トップ時）', R.P4?.xFactor != null ? `${R.P4.xFactor.toFixed(0)}°（目標:12°以上）` : '—'],
      ['P6 腰→肩リード（ダウンスイング）', R.P6?.lead != null ? `${R.P6.lead}フレーム先行（目標:2フレーム以上）` : '—'],
      ['P9 体重移動率', R.P9?.weightRatio != null ? `${(R.P9.weightRatio*100).toFixed(0)}%（目標:85%以上）` : '—'],
      ['P9 右かかと浮き', R.P9?.heelDelta != null ? (R.P9.heelDelta < -0.02 ? 'あり ✓' : 'なし') : '—'],
      ['P9 肩の回転完了', R.P9?.rotComp != null ? `${R.P9.rotComp.toFixed(0)}°（目標:150°以上）` : '—'],
    ];
    rows.forEach(([k, v]) => {
      const row = document.createElement('div');
      row.className = 'det-row';
      row.innerHTML = `<span class="det-k">${k}</span><span class="det-v">${v}</span>`;
      det.appendChild(row);
    });
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  _showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(`screen-${name}`);
    if (el) el.classList.add('active');
    const camVisible = name === 'framing' || name === 'recording';
    document.getElementById('cam-layer').classList.toggle('visible', camVisible);
    this.state = { setup:AppState.SETUP, framing:AppState.FRAMING,
      recording:AppState.RECORDING, results:AppState.RESULTS }[name] || this.state;
  }

  _reset() {
    this._previewActive  = false;
    this.latestLms       = null;
    this.latestFrameData = null;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.cdTimer) clearInterval(this.cdTimer);
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    this.phaseDetector.reset();
    this.analyzer.reset();
    this.swingBuffer = [];
    this.phaseSnaps  = {};
    this.results     = null;
    this.swingDetected = false;
    this.referenceCollected = false;
    this.state = AppState.SETUP;
    this._showScreen('setup');
  }

  _goToRecording() {
    this._showScreen('framing');
    this.phaseDetector.reset();
    this.analyzer.reset();
    this.swingBuffer = [];
    this.phaseSnaps  = {};
    this.results     = null;
    this.swingDetected = false;
    this.referenceCollected = false;
    this.state = AppState.FRAMING;
    if (this.stream && !this.rafId) this._startLoop();
  }

  _updatePerfDisplay() {
    const el = document.getElementById('perf-badge');
    if (el) el.textContent = `${this.anFps} fps 解析`;
  }

  _goToResults() {
    this._showScreen('results');
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function statusLabel(s) {
  return { ok:'問題なし', warn:'注意', problem:'要改善', unknown:'—' }[s] || '—';
}

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => { window._app = new App(); });
