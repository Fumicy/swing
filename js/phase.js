import { getLM, Smoother, mid } from './utils.js?v=0503-5';
import { PHASE, THRESH } from './config.js?v=0503-5';

// Detects current swing phase from landmark time series.
// Right-handed golfer, front camera assumed.
export class PhaseDetector {
  constructor() {
    this._phase = PHASE.ADDRESS;
    this._wristSmoother = new Smoother(5);
    this._prevWristX = null;
    this._peakWristSpeed = 0;
    this._topCandidate = 0;
    this._framesSinceTop = 0;
    this._addressFrames = 0;
    this._backswingPeak = 0;
    this.onPhaseChange = null; // callback(newPhase)
  }

  get phase() { return this._phase; }

  // Call each frame. Returns current phase string.
  update(lms, frameIdx) {
    const lw = getLM(lms, 15); // left wrist
    if (!lw) return this._phase;

    const wx = lw.x;
    const rawDx = this._prevWristX !== null ? wx - this._prevWristX : 0;
    this._prevWristX = wx;

    const smoothDx = this._wristSmoother.push(rawDx);
    const speed = Math.abs(smoothDx);

    const T = THRESH.PHASE;

    switch (this._phase) {
      case PHASE.ADDRESS:
        this._addressFrames++;
        if (speed > T.moveStart && this._addressFrames > 8) {
          this._setPhase(PHASE.BACKSWING);
          this._backswingPeak = wx;
        }
        break;

      case PHASE.BACKSWING:
        // Track peak wrist position (rightward movement for right-handed golfer)
        if (wx > this._backswingPeak) this._backswingPeak = wx;
        // Top = wrist reverses direction (speed near zero or direction flips)
        if (speed < T.stopThresh && this._prevWristX !== null) {
          this._setPhase(PHASE.TOP);
          this._framesSinceTop = 0;
        }
        break;

      case PHASE.TOP:
        this._framesSinceTop++;
        // Downswing = wrist moving back (leftward, negative dx)
        if (smoothDx < -T.moveStart) {
          this._setPhase(PHASE.DOWNSWING);
          this._peakWristSpeed = 0;
        }
        // Safety: if stuck at top too long, move on
        if (this._framesSinceTop > 15) {
          this._setPhase(PHASE.DOWNSWING);
          this._peakWristSpeed = 0;
        }
        break;

      case PHASE.DOWNSWING:
        if (speed > this._peakWristSpeed) this._peakWristSpeed = speed;
        // Follow = speed has dropped to 30% of peak
        if (this._peakWristSpeed > T.moveStart * 3 &&
            speed < this._peakWristSpeed * T.finishRatio) {
          this._setPhase(PHASE.FOLLOW);
        }
        break;

      case PHASE.FOLLOW:
        // Complete = motion has essentially stopped
        if (speed < T.stopThresh) {
          this._setPhase(PHASE.COMPLETE);
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
    if (this.onPhaseChange) this.onPhaseChange(p, prev);
  }

  reset() {
    this._phase = PHASE.ADDRESS;
    this._wristSmoother.reset();
    this._prevWristX = null;
    this._peakWristSpeed = 0;
    this._topCandidate = 0;
    this._framesSinceTop = 0;
    this._addressFrames = 0;
    this._backswingPeak = 0;
  }
}
