// 5-frame causal moving average
export class Smoother {
  constructor(size = 5) { this.size = size; this.buf = []; }
  push(v) {
    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
    return this.value();
  }
  value() {
    if (!this.buf.length) return 0;
    return this.buf.reduce((a, b) => a + b, 0) / this.buf.length;
  }
  reset() { this.buf = []; }
}

// Get landmark with visibility guard; returns null if invisible
export function getLM(lms, idx) {
  if (!lms || !lms[idx]) return null;
  if ((lms[idx].visibility ?? 1) < 0.35) return null;
  return lms[idx];
}

// Midpoint of two landmarks
export function mid(a, b) {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Distance between two 2D points
export function dist2(a, b) {
  if (!a || !b) return 0;
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Angle of vector AB in degrees (atan2)
export function angleDeg(a, b) {
  if (!a || !b) return 0;
  return Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
}

// Normalize an angle difference to [-180, 180]
export function normAngle(deg) {
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
}

// Mean of a numeric array
export function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Clamp
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Map landmark to canvas pixel
export function lmPx(lm, w, h) {
  return { x: lm.x * w, y: lm.y * h };
}

// Shoulder width (normalized) — key normalizer
export function shoulderWidth(lms) {
  const ls = getLM(lms, 11), rs = getLM(lms, 12);
  if (!ls || !rs) return 0.2; // fallback
  return Math.abs(ls.x - rs.x);
}
