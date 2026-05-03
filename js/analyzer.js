import { getLM, mid, dist2, angleDeg, normAngle, mean, Smoother, shoulderWidth } from './utils.js';
import { LM, THRESH, STATUS, PHASE } from './config.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function classify(v, warnThresh, probThresh) {
  if (v >= probThresh) return STATUS.PROBLEM;
  if (v >= warnThresh) return STATUS.WARN;
  return STATUS.OK;
}

function worstStatus(a, b) {
  const rank = { ok:0, warn:1, problem:2, unknown:-1 };
  return rank[a] >= rank[b] ? a : b;
}

// ── SwingAnalyzer ─────────────────────────────────────────────────────────────
// Processes one frame at a time. Call setReference() during address,
// then update() every frame. Call getResults() after COMPLETE.

export class SwingAnalyzer {
  constructor() {
    this._refFrames   = [];   // address reference frames (landmarks)
    this._ref         = null; // computed reference values
    this._isRef       = true; // still collecting reference
    this._frameData   = [];   // per-frame computed data

    // Smoothers
    this._headXS  = new Smoother(5);
    this._headYS  = new Smoother(5);
    this._hipXS   = new Smoother(5);
    this._spineAS = new Smoother(5);
    this._shoulderS = new Smoother(5);
    this._hipYS   = new Smoother(5);

    this._backswingHipDeltas = [];
    this._peakP1X = 0; this._peakP1Y = 0; this._peakP1Total = 0;
    this._peakP3  = 0;
    this._p9Data  = null;
  }

  // Feed address frames (first 10)
  feedReference(lms) {
    if (this._refFrames.length < 10) this._refFrames.push(lms);
    if (this._refFrames.length === 10) this._computeRef();
  }

  _computeRef() {
    const frames = this._refFrames;
    const avg = (fn) => mean(frames.map(fn).filter(v => v !== null));

    const swArr = frames.map(f => shoulderWidth(f)).filter(v => v > 0);
    const sw = swArr.length ? mean(swArr) : 0.2;

    // Head center reference
    const headXArr = frames.map(f => {
      const n=getLM(f,LM.NOSE), le=getLM(f,LM.L_EAR), re=getLM(f,LM.R_EAR);
      return (n&&le&&re) ? (n.x+le.x+re.x)/3 : null;
    }).filter(v=>v!==null);
    const headYArr = frames.map(f => {
      const n=getLM(f,LM.NOSE), le=getLM(f,LM.L_EAR), re=getLM(f,LM.R_EAR);
      return (n&&le&&re) ? (n.y+le.y+re.y)/3 : null;
    }).filter(v=>v!==null);

    // Hip center reference
    const hipXArr = frames.map(f => {
      const lh=getLM(f,LM.L_HIP), rh=getLM(f,LM.R_HIP);
      return (lh&&rh) ? (lh.x+rh.x)/2 : null;
    }).filter(v=>v!==null);

    // Spine angle reference (shoulder mid → hip mid angle)
    const spineArr = frames.map(f => this._spineAngle(f)).filter(v=>v!==null);

    // Shoulder angle reference
    const shoulderArr = frames.map(f => {
      const ls=getLM(f,LM.L_SHOULDER), rs=getLM(f,LM.R_SHOULDER);
      return (ls&&rs) ? angleDeg(rs,ls) : null;
    }).filter(v=>v!==null);

    // Shoulder mid Y reference (for P3 front camera proxy)
    const sMidYArr = frames.map(f => {
      const ls=getLM(f,LM.L_SHOULDER), rs=getLM(f,LM.R_SHOULDER);
      return (ls&&rs) ? (ls.y+rs.y)/2 : null;
    }).filter(v=>v!==null);

    // Ball position estimate (foot center x)
    const ballXArr = frames.map(f => {
      const lft=getLM(f,LM.L_FOOT), rft=getLM(f,LM.R_FOOT);
      return (lft&&rft) ? (lft.x+rft.x)/2 : null;
    }).filter(v=>v!==null);

    // Heel reference for P9
    const rHeelArr = frames.map(f => {
      const rh=getLM(f,LM.R_HEEL), rf=getLM(f,LM.R_FOOT);
      return (rh&&rf) ? rh.y-rf.y : null;
    }).filter(v=>v!==null);

    this._ref = {
      sw,
      headX: headXArr.length ? mean(headXArr) : 0.5,
      headY: headYArr.length ? mean(headYArr) : 0.3,
      hipX:  hipXArr.length  ? mean(hipXArr)  : 0.5,
      spine: spineArr.length ? mean(spineArr) : 0,
      shoulder: shoulderArr.length ? mean(shoulderArr) : 0,
      sMidY: sMidYArr.length ? mean(sMidYArr) : 0.3,
      ballX: ballXArr.length ? mean(ballXArr) : 0.5,
      rHeelDiff: rHeelArr.length ? mean(rHeelArr) : 0,
      // For P9: ankle positions
      lAnkleX: mean(frames.map(f=>{const a=getLM(f,LM.L_ANKLE);return a?a.x:null}).filter(v=>v!==null)) || 0.35,
      rAnkleX: mean(frames.map(f=>{const a=getLM(f,LM.R_ANKLE);return a?a.x:null}).filter(v=>v!==null)) || 0.65,
    };
  }

  get hasRef() { return this._ref !== null; }

  _spineAngle(lms) {
    const ls=getLM(lms,LM.L_SHOULDER), rs=getLM(lms,LM.R_SHOULDER);
    const lh=getLM(lms,LM.L_HIP),     rh=getLM(lms,LM.R_HIP);
    if (!ls||!rs||!lh||!rh) return null;
    const sm = mid(ls,rs), hm = mid(lh,rh);
    return angleDeg(hm, sm); // degrees, spine from hip to shoulder
  }

  // Update with one frame. phase = current PHASE constant.
  update(lms, phase) {
    if (!this._ref) return;

    const r   = this._ref;
    const sw  = shoulderWidth(lms) || r.sw;
    const fd  = { phase, p1:{}, p2:{}, p3:{}, p9:{} };

    // ── P1: Head Stability ──────────────────────────────────────────────────
    const n=getLM(lms,LM.NOSE), le=getLM(lms,LM.L_EAR), re=getLM(lms,LM.R_EAR);
    if (n && le && re) {
      const hx = (n.x+le.x+re.x)/3;
      const hy = (n.y+le.y+re.y)/3;
      const dx = this._headXS.push(hx) - r.headX;
      const dy = this._headYS.push(hy) - r.headY;
      const ndx = dx / r.sw, ndy = dy / r.sw;
      const tot = Math.sqrt(ndx*ndx + ndy*ndy);
      fd.p1 = { dx:ndx, dy:ndy, total:tot,
        status: classify(Math.max(Math.abs(ndx), Math.abs(ndy)),
                         THRESH.P1.warnX, THRESH.P1.probX) };
      if (tot > this._peakP1Total) {
        this._peakP1Total = tot;
        this._peakP1X = Math.abs(ndx);
        this._peakP1Y = Math.abs(ndy);
        this._worstP1Phase = phase;
      }
    } else {
      fd.p1 = { dx:0, dy:0, total:0, status: STATUS.UNKNOWN };
    }

    // ── P2: Lateral Sway (backswing only) ──────────────────────────────────
    const lh=getLM(lms,LM.L_HIP), rh=getLM(lms,LM.R_HIP);
    if (lh && rh) {
      const hx = (lh.x+rh.x)/2;
      const sway = (this._hipXS.push(hx) - r.hipX) / r.sw;
      fd.p2 = { sway, status: STATUS.UNKNOWN };
      if (phase === PHASE.BACKSWING) {
        this._backswingHipDeltas.push(Math.abs(sway));
        fd.p2.status = classify(Math.abs(sway), THRESH.P2.warn, THRESH.P2.prob);
      }
    } else {
      fd.p2 = { sway:0, status: STATUS.UNKNOWN };
    }

    // ── P3: Spine Angle / Early Extension ──────────────────────────────────
    const sa = this._spineAngle(lms);
    if (sa !== null) {
      const delta = Math.abs(normAngle(this._spineAS.push(sa) - r.spine));
      // Shoulder-mid Y rise (front camera proxy for early extension)
      const ls2=getLM(lms,LM.L_SHOULDER), rs2=getLM(lms,LM.R_SHOULDER);
      const sMidY = (ls2&&rs2) ? (ls2.y+rs2.y)/2 : r.sMidY;
      const sMidRise = r.sMidY - this._shoulderS.push(sMidY); // positive = shoulders rose

      const earlyExt = (phase===PHASE.DOWNSWING || phase===PHASE.FOLLOW) &&
                       (delta > THRESH.P3.warn || sMidRise > 0.04);

      const status = classify(delta, THRESH.P3.warn, THRESH.P3.prob);
      fd.p3 = { delta, sMidRise, earlyExt, status };
      if (delta > this._peakP3) {
        this._peakP3 = delta;
        this._worstP3Phase = phase;
      }
    } else {
      fd.p3 = { delta:0, sMidRise:0, earlyExt:false, status:STATUS.UNKNOWN };
    }

    // ── P9: Follow Balance (only evaluate in follow/complete) ───────────────
    if (phase === PHASE.FOLLOW || phase === PHASE.COMPLETE) {
      const la=getLM(lms,LM.L_ANKLE), ra=getLM(lms,LM.R_ANKLE);
      const lk=getLM(lms,LM.L_KNEE),  rk=getLM(lms,LM.R_KNEE);
      const ls3=getLM(lms,LM.L_SHOULDER), rs3=getLM(lms,LM.R_SHOULDER);
      const lh2=getLM(lms,LM.L_HIP),  rh2=getLM(lms,LM.R_HIP);

      if (la&&ra&&lk&&rk&&ls3&&rs3&&lh2&&rh2) {
        // Weight transfer
        const cog = (ls3.x+rs3.x+lh2.x+rh2.x+lk.x+rk.x) / 6;
        const lax = la.x, rax = ra.x;
        const weightRatio = (cog - rax) / (lax - rax + 0.001);

        // Heel lift
        const rHeel=getLM(lms,LM.R_HEEL), rFoot=getLM(lms,LM.R_FOOT);
        const heelDiff = (rHeel&&rFoot) ? rHeel.y - rFoot.y : r.rHeelDiff;
        const heelDelta = heelDiff - r.rHeelDiff;

        // Rotation (shoulder angle change)
        const finishAngle = angleDeg(rs3, ls3);
        const rotComp = Math.abs(normAngle(finishAngle - r.shoulder));

        // CoG variance (stability)
        if (!this._cogBuf) this._cogBuf = [];
        this._cogBuf.push(cog);
        if (this._cogBuf.length > 10) this._cogBuf.shift();
        const cogMean = mean(this._cogBuf);
        const cogVar = mean(this._cogBuf.map(v=>(v-cogMean)**2));

        this._p9Data = { weightRatio, heelDelta, rotComp, cogVar,
          wStatus: classify(THRESH.P9.weightOk - weightRatio, 0, THRESH.P9.weightOk - THRESH.P9.weightProb),
          hStatus: heelDelta < THRESH.P9.heelLift ? STATUS.OK : STATUS.WARN,
          rStatus: rotComp > THRESH.P9.rotOk ? STATUS.OK : rotComp > THRESH.P9.rotWarn ? STATUS.WARN : STATUS.PROBLEM,
          cStatus: cogVar < THRESH.P9.cogOk ? STATUS.OK : cogVar < THRESH.P9.cogWarn ? STATUS.WARN : STATUS.PROBLEM,
        };
        fd.p9 = this._p9Data;
      }
    }

    this._frameData.push(fd);
    return fd;
  }

  // Compute final results after swing complete
  getResults() {
    if (!this._ref) return null;

    // P1 final
    const p1Status = classify(
      Math.max(this._peakP1X, this._peakP1Y),
      THRESH.P1.warnX, THRESH.P1.probX
    );

    // P2 final
    const maxSway = this._backswingHipDeltas.length
      ? Math.max(...this._backswingHipDeltas) : 0;
    const p2Status = classify(maxSway, THRESH.P2.warn, THRESH.P2.prob);

    // P3 final
    const p3Status = classify(this._peakP3, THRESH.P3.warn, THRESH.P3.prob);
    const earlyExt = this._frameData.some(f => f.p3?.earlyExt);

    // P9 final
    let p9Status = STATUS.UNKNOWN;
    if (this._p9Data) {
      const d = this._p9Data;
      p9Status = worstStatus(d.wStatus, worstStatus(d.hStatus, worstStatus(d.rStatus, d.cStatus)));
    }

    // Per-frame worst P1/P3 for scrubber highlight
    const p1Frames = this._frameData.map(f => f.p1?.total ?? 0);
    const p3Frames = this._frameData.map(f => f.p3?.delta ?? 0);

    return {
      P1: { status: p1Status, peakX: this._peakP1X, peakY: this._peakP1Y,
            peakTotal: this._peakP1Total, worstPhase: this._worstP1Phase },
      P2: { status: p2Status, maxSway },
      P3: { status: p3Status, peakDelta: this._peakP3, earlyExt,
            worstPhase: this._worstP3Phase },
      P9: { status: p9Status, ...this._p9Data },
      frameData: this._frameData,
      p1Frames, p3Frames,
    };
  }

  reset() {
    this._refFrames = []; this._ref = null;
    this._frameData = [];
    this._headXS.reset(); this._headYS.reset();
    this._hipXS.reset();  this._spineAS.reset();
    this._shoulderS.reset(); this._hipYS.reset();
    this._backswingHipDeltas = [];
    this._peakP1X = 0; this._peakP1Y = 0; this._peakP1Total = 0;
    this._peakP3 = 0; this._p9Data = null; this._cogBuf = null;
    this._worstP1Phase = null; this._worstP3Phase = null;
  }
}

