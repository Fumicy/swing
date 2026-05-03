import { getLM, Smoother } from './utils.js?v=0503-14';
import { PHASE, THRESH } from './config.js?v=0503-14';

// Phase detection: wrist centroid + Euclidean speed + position guards.
// Pure pose-based — no club signal. Right-handed golfer, front camera assumed.

export class PhaseDetector {
  constructor() {
    this._phase = PHASE.ADDRESS;
    this._dxS = new Smoother(5);
    this._dyS = new Smoother(5);
    this._prevWx      = null;
    this._prevWy      = null;
    this._phaseFrames = 0;
    this._moveFrames  = 0;
    this._peakSpeed   = 0;
    this._stoppedFrames = 0;

    // Address reference (first refFrames ADDRESS frames)
    this._ref    = null;
    this._refAcc = { wristY:0, shoulderY:0, hipY:0, n:0 };

    this.onPhaseChange = null;
  }

  get phase() { return this._phase; }

  update(lms) {
    const lw = getLM(lms, 15), rw = getLM(lms, 16);
    const ls = getLM(lms, 11), rs = getLM(lms, 12);
    const lh = getLM(lms, 23), rh = getLM(lms, 24);

    let wx, wy;
    if      (lw && rw) { wx = (lw.x + rw.x) / 2; wy = (lw.y + rw.y) / 2; }
    else if (lw)       { wx = lw.x; wy = lw.y; }
    else if (rw)       { wx = rw.x; wy = rw.y; }
    else               return this._phase;

    const shoulderY = (ls && rs) ? (ls.y + rs.y) / 2 : (this._ref?.shoulderY ?? 0.35);
    const hipY      = (lh && rh) ? (lh.y + rh.y) / 2 : (this._ref?.hipY     ?? 0.60);

    const rawDx = this._prevWx !== null ? wx - this._prevWx : 0;
    const rawDy = this._prevWy !== null ? wy - this._prevWy : 0;
    this._prevWx = wx; this._prevWy = wy;
    const sdx   = this._dxS.push(rawDx);
    const sdy   = this._dyS.push(rawDy);
    const speed = Math.sqrt(sdx * sdx + sdy * sdy);

    const T = THRESH.PHASE;
    this._phaseFrames++;

    // Collect address reference
    if (this._phase === PHASE.ADDRESS && this._ref === null) {
      const a = this._refAcc;
      a.wristY += wy;
      if (ls && rs) a.shoulderY += (ls.y + rs.y) / 2;
      if (lh && rh) a.hipY      += (lh.y + rh.y) / 2;
      a.n++;
      if (a.n >= T.refFrames) {
        this._ref = {
          wristY:    a.wristY    / a.n,
          shoulderY: a.shoulderY / a.n || 0.35,
          hipY:      a.hipY      / a.n || 0.60,
        };
      }
    }

    switch (this._phase) {

      // ── ADDRESS ───────────────────────────────────────────────────────────
      case PHASE.ADDRESS:
        if (this._phaseFrames < 10) break;
        if (speed > T.moveStart) {
          if (++this._moveFrames >= T.moveFrames) this._setPhase(PHASE.BACKSWING);
        } else {
          this._moveFrames = 0;
        }
        break;

      // ── BACKSWING ─────────────────────────────────────────────────────────
      case PHASE.BACKSWING: {
        const refWY  = this._ref?.wristY ?? hipY;
        const midY   = (shoulderY + refWY) / 2;
        const risen  = wy < midY;
        if (speed < T.stopThresh && risen) this._setPhase(PHASE.TOP);
        // Safety: 3 s → force TOP
        if (this._phaseFrames > 90) this._setPhase(PHASE.TOP);
        break;
      }

      // ── TOP ───────────────────────────────────────────────────────────────
      case PHASE.TOP: {
        const wristDown = sdy > T.moveStart * 0.8 && speed > T.moveStart;
        if (wristDown) {
          this._setPhase(PHASE.DOWNSWING);
          this._peakSpeed = 0;
        }
        if (this._phaseFrames > 12) {
          this._setPhase(PHASE.DOWNSWING);
          this._peakSpeed = 0;
        }
        break;
      }

      // ── DOWNSWING ─────────────────────────────────────────────────────────
      case PHASE.DOWNSWING: {
        if (speed > this._peakSpeed) this._peakSpeed = speed;

        const refWY = this._ref?.wristY ?? hipY;

        // Wrist returns to near address height
        const wristImpact = wy > refWY - 0.08 && this._peakSpeed > T.moveStart;

        // Speed-drop: passed peak velocity → follow-through
        const speedDrop = this._peakSpeed > T.moveStart * 2 &&
                          speed < this._peakSpeed * T.finishRatio;

        if (wristImpact || speedDrop) this._setPhase(PHASE.FOLLOW);
        break;
      }

      // ── FOLLOW ────────────────────────────────────────────────────────────
      case PHASE.FOLLOW:
        if (speed < T.stopThresh) {
          if (++this._stoppedFrames >= 6) this._setPhase(PHASE.COMPLETE);
        } else {
          this._stoppedFrames = 0;
        }
        break;

      case PHASE.COMPLETE:
        break;
    }

    return this._phase;
  }

  _setPhase(p) {
    if (p === this._phase) return;
    const prev = this._phase;
    this._phase = p;
    this._phaseFrames = 0;
    this._stoppedFrames = 0;
    if (this.onPhaseChange) this.onPhaseChange(p, prev);
  }

  reset() {
    this._phase = PHASE.ADDRESS;
    this._dxS.reset(); this._dyS.reset();
    this._prevWx = null; this._prevWy = null;
    this._phaseFrames = 0; this._moveFrames = 0;
    this._peakSpeed = 0; this._stoppedFrames = 0;
    this._ref    = null;
    this._refAcc = { wristY:0, shoulderY:0, hipY:0, n:0 };
  }
}
