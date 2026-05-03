import { getLM, Smoother } from './utils.js?v=0503-19';
import { PHASE, THRESH } from './config.js?v=0503-19';

// Phase detection: wrist centroid + Euclidean speed + position guards.
// Club head data (from ClubDetector) is used as a secondary signal when available.
// Right-handed golfer, front camera (飛球線後方) assumed.
//
// TOP detection  Ethree independent signals (first to fire wins):
//   (a) speed < stopThresh && risen             Eclassic pause-at-top
//   (b) wrist Y local minimum reversal          Econtinuous swing without pause
//   (c) club head Y local minimum reversal      Emost reliable when YOLO active
//
// DOWNSWING→FOLLOW  Ethree signals + timeout:
//   (a) wristImpact: wrist returns to address height
//   (b) speedDrop: velocity falls to 25% of peak
//   (c) clubImpact: club.y > 0.72 (near ground)  EYOLO
//   (d) 20-frame timeout (absolute safety)

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

    // Wrist Y minimum (tracks the highest point reached during backswing)
    this._wristYMin = null;

    // Club head Y history for reversal detection (last 6, updated when conf ≥ 0.40)
    this._clubYHist = [];

    this.onPhaseChange = null;
  }

  get phase() { return this._phase; }

  // club: { x, y, conf } normalized 0-1 (from ClubDetector), or null
  update(lms, club = null) {
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

    // Update club head Y history when YOLO confidence is sufficient
    if (club && club.conf >= 0.40) {
      this._clubYHist.push(club.y);
      if (this._clubYHist.length > 6) this._clubYHist.shift();
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
        const refWY = this._ref?.wristY ?? hipY;
        const midY  = (shoulderY + refWY) / 2;
        const risen = wy < midY;

        // Track wrist Y minimum (highest point reached  Esmaller Y = higher in image)
        if (this._wristYMin === null || wy < this._wristYMin) this._wristYMin = wy;

        // (a) Classic: wrist slows and is high enough
        const slowTop = speed < T.stopThresh && risen;

        // (b) Wrist Y reversal: wrist was rising but now moving down (continuous swing)
        //     Require wrist to have reached at least shoulder level first
        const risenEnough  = this._wristYMin < shoulderY + 0.06;
        const wristReversal = risenEnough && sdy > T.moveStart && speed > T.moveStart;

        // (c) Club head Y reversal (YOLO)
        const clubTop = this._detectClubReversal();

        if (slowTop || wristReversal || clubTop) this._setPhase(PHASE.TOP);

        // Safety: ~0.85 s timeout (reduced from 90 ↁE25 frames)
        if (this._phaseFrames > 25) this._setPhase(PHASE.TOP);
        break;
      }

      // ── TOP ───────────────────────────────────────────────────────────────
      case PHASE.TOP: {
        let clubDescending = false;
        if (this._clubYHist.length >= 2) {
          const n = this._clubYHist.length;
          clubDescending = this._clubYHist[n-1] > this._clubYHist[n-2] + 0.008;
        }
        const wristDown = sdy > T.moveStart * 0.8 && speed > T.moveStart;

        if (clubDescending || wristDown) {
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

        // (a) Club head near ground after real downswing (YOLO)
        const clubImpact = club && club.conf >= 0.40 &&
                           club.y > 0.72 && this._peakSpeed > T.moveStart;

        // (b) Wrist returns to near address height
        const wristImpact = wy > refWY - 0.08 && this._peakSpeed > T.moveStart;

        // (c) Speed-drop: past peak velocity
        const speedDrop = this._peakSpeed > T.moveStart * 2 &&
                          speed < this._peakSpeed * T.finishRatio;

        if (clubImpact || wristImpact || speedDrop) this._setPhase(PHASE.FOLLOW);

        // Safety: downswing never exceeds 0.67 s (20 frames)
        if (this._phaseFrames > 20) this._setPhase(PHASE.FOLLOW);
        break;
      }

      // ── FOLLOW ────────────────────────────────────────────────────────────
      case PHASE.FOLLOW:
        if (speed < T.stopThresh * 2) {
          if (++this._stoppedFrames >= 3) this._setPhase(PHASE.COMPLETE);
        } else {
          this._stoppedFrames = 0;
        }
        // Safety: finish detected → complete within 1.5 s regardless
        if (this._phaseFrames > 45) this._setPhase(PHASE.COMPLETE);
        break;

      case PHASE.COMPLETE:
        break;
    }

    return this._phase;
  }

  // Club head Y local minimum: ascending (decreasing Y) then descending (increasing Y) = TOP
  _detectClubReversal() {
    const h = this._clubYHist;
    if (h.length < 3) return false;
    const n = h.length;
    const prev2 = h[n - 3], prev = h[n - 2], curr = h[n - 1];
    return prev2 > prev + 0.012 && curr > prev + 0.012;
  }

  _setPhase(p) {
    if (p === this._phase) return;
    const prev = this._phase;
    this._phase = p;
    this._phaseFrames = 0;
    this._stoppedFrames = 0;
    if (p === PHASE.BACKSWING) {
      this._wristYMin  = null;
      this._clubYHist  = [];
    }
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
    this._wristYMin = null;
    this._clubYHist = [];
  }
}
