import { getLM, lmPx } from './utils.js?v=0503-6';
import { SKELETON, KEY_LM, PHASE_LABELS, STATUS } from './config.js?v=0503-6';

const STATUS_COLOR = { ok:'#22c55e', warn:'#f59e0b', problem:'#ef4444', unknown:'#888' };
const PHASE_COLOR  = {
  address:'#58a6ff', backswing:'#79c0ff', top:'#e3b341',
  downswing:'#ff7b72', follow:'#56d364', complete:'#56d364',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width  = w;
      this.canvas.height = h;
    }
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawSkeleton(lms, frameData) {
    if (!lms) return;
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;

    // Determine overall status color for this frame
    let color = '#58d678';
    if (frameData) {
      const s = frameData.p1?.status;
      if (s === STATUS.PROBLEM) color = '#ef4444';
      else if (s === STATUS.WARN) color = '#f59e0b';
    }

    // Connections
    ctx.lineWidth = 2.5;
    SKELETON.forEach(([a, b]) => {
      const la = getLM(lms, a), lb = getLM(lms, b);
      if (!la || !lb) return;
      ctx.strokeStyle = 'rgba(88,214,120,.55)';
      ctx.beginPath();
      ctx.moveTo(la.x * W, la.y * H);
      ctx.lineTo(lb.x * W, lb.y * H);
      ctx.stroke();
    });

    // Joints
    lms.forEach((lm, i) => {
      if ((lm?.visibility ?? 0) < 0.35) return;
      const isKey = KEY_LM.includes(i);
      ctx.beginPath();
      ctx.arc(lm.x * W, lm.y * H, isKey ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = isKey ? color : 'rgba(88,214,120,.38)';
      ctx.fill();
    });
  }

  drawHeadIndicator(lms, p1Data, refHeadX, refHeadY) {
    if (!lms || !p1Data || p1Data.total < 0.05) return;
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const nose = getLM(lms, 0);
    if (!nose) return;

    const nx = nose.x * W, ny = nose.y * H;
    const status = p1Data.status;
    const c = STATUS_COLOR[status] || STATUS_COLOR.unknown;

    ctx.beginPath();
    ctx.arc(nx, ny, 18, 0, Math.PI * 2);
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Arrow showing direction of movement
    if (p1Data.total > 0.05) {
      const dx = p1Data.dx * 80, dy = p1Data.dy * 80;
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.lineTo(nx + dx, ny + dy);
      ctx.strokeStyle = c;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  drawHipIndicator(lms, p2Data) {
    if (!lms || !p2Data || p2Data.status === 'unknown') return;
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const lh = getLM(lms, 23), rh = getLM(lms, 24);
    if (!lh || !rh) return;

    const mx = ((lh.x + rh.x) / 2) * W;
    const my = ((lh.y + rh.y) / 2) * H;
    const c = STATUS_COLOR[p2Data.status];

    ctx.beginPath();
    ctx.arc(mx, my, 14, 0, Math.PI * 2);
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (Math.abs(p2Data.sway) > 0.06) {
      const dx = p2Data.sway * 200;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + dx, my);
      ctx.strokeStyle = c;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  drawPhaseLabel(phase) {
    const ctx = this.ctx;
    const label = PHASE_LABELS[phase] || phase;
    const color = PHASE_COLOR[phase] || '#8b949e';
    ctx.font = 'bold 13px system-ui';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillRect(10, 10, tw + 16, 26);
    ctx.fillStyle = color;
    ctx.fillText(label, 18, 28);
  }

  drawFrameBudget(mpMs, totalMs) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const budget = 33.3;
    const pct = Math.min(totalMs / budget, 1);
    const bw = 120, bx = W - bw - 10, by = H - 30;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(bx, by, bw, 12);
    ctx.fillStyle = pct > .85 ? '#ef4444' : pct > .6 ? '#f59e0b' : '#22c55e';
    ctx.fillRect(bx, by, bw * pct, 12);
    ctx.font = '9px system-ui';
    ctx.fillStyle = '#e6edf3';
    ctx.fillText(`${totalMs.toFixed(1)}ms / ${budget}ms`, bx + 3, by + 10);
  }

  drawRecordingDot() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    ctx.beginPath();
    ctx.arc(W - 20, 18, 6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(239,68,68,${0.5 + 0.5 * Math.sin(Date.now() / 400)})`;
    ctx.fill();
    ctx.font = '11px system-ui';
    ctx.fillStyle = '#ff7b72';
    ctx.fillText('REC', W - 55, 23);
  }

  drawSwingDetected() {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.strokeStyle = 'rgba(88,214,120,.8)';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, W - 8, H - 8);
  }

  // Draw stored frame (JPEG) + skeleton overlay — used in results viewer
  drawStoredFrame(imageEl, lms, frameData) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.drawImage(imageEl, 0, 0, W, H);
    if (lms) this.drawSkeleton(lms, frameData);
    if (lms && frameData) {
      this.drawHeadIndicator(lms, frameData.p1);
      this.drawHipIndicator(lms, frameData.p2);
    }
  }
}
