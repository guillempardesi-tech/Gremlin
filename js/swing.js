/**
 * Real-time swing analysis from MediaPipe Pose landmarks.
 *
 * Pipeline per video frame:
 *   1. World landmarks (metric, hip-centred) + image landmarks arrive.
 *   2. Every landmark channel is smoothed with a One-Euro filter
 *      (Casiez, Roussel & Vogel, CHI 2012) — the standard low-latency
 *      filter for interactive pose tracking: heavy smoothing at rest,
 *      minimal lag during fast motion (exactly what a golf swing needs).
 *   3. A metre-per-normalized-unit scale is estimated each frame from the
 *      ratio of world-space to image-space shoulder width, so image-space
 *      translations (head sway, hip sway — invisible in hip-centred world
 *      coordinates) can be measured in centimetres.
 *   4. A phase state machine segments the swing:
 *      IDLE → ADDRESS → BACKSWING → TOP → DOWNSWING → IMPACT → FINISH
 *   5. At completion, biomechanical metrics and the clubhead-speed estimate
 *      are emitted.
 *
 * Clubhead speed estimation (the camera cannot resolve the clubhead itself —
 * at 45+ m/s it moves ~1.5 m between 30 fps frames and motion-blurs):
 * the hands are trackable, so we measure peak hand speed in the downswing
 * (3-point parabolic refinement around the sampled maximum) and scale it
 * through the double-pendulum lever geometry:
 *
 *   CHS ≈ v_hands,peak × (r_wrist + 0.95·L_club) / r_wrist × G_release
 *
 * where r_wrist is the measured shoulder-pivot→wrist radius and G_release
 * (≈1.53) accounts for the wrist-release whip: at impact the club rotates
 * faster than the arms as momentum transfers down the chain, and hand speed
 * peaks mid-downswing then falls ~20–30% into impact (Nesbit 2005, Jorgensen
 * "The Physics of Golf"). The product is calibrated so that a tour-typical
 * peak hand speed (~11.5 m/s) with a driver maps to ~113 mph clubhead speed.
 */

// MediaPipe Pose landmark indices
export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
};

/** One-Euro filter for one scalar channel. */
class OneEuro {
  constructor(minCutoff = 1.7, beta = 0.4, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(x, t) {
    if (this.xPrev === null) {
      this.xPrev = x; this.tPrev = t;
      return x;
    }
    const dt = Math.max(1e-3, t - this.tPrev);
    this.tPrev = t;
    const dx = (x - this.xPrev) / dt;
    const aD = OneEuro.alpha(this.dCutoff, dt);
    this.dxPrev = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const a = OneEuro.alpha(cutoff, dt);
    this.xPrev = a * x + (1 - a) * this.xPrev;
    return this.xPrev;
  }
  reset() { this.xPrev = null; this.dxPrev = 0; this.tPrev = null; }
}

/** One-Euro filter over a set of 3D landmarks. */
class LandmarkFilter {
  constructor(indices, minCutoff, beta) {
    this.filters = new Map();
    for (const i of indices) {
      this.filters.set(i, [new OneEuro(minCutoff, beta), new OneEuro(minCutoff, beta), new OneEuro(minCutoff, beta)]);
    }
  }
  apply(landmarks, t) {
    const out = {};
    for (const [i, [fx, fy, fz]] of this.filters) {
      const lm = landmarks[i];
      if (!lm) return null;
      out[i] = {
        x: fx.filter(lm.x, t),
        y: fy.filter(lm.y, t),
        z: fz.filter(lm.z, t),
        visibility: lm.visibility ?? 1,
      };
    }
    return out;
  }
  reset() { for (const fs of this.filters.values()) fs.forEach((f) => f.reset()); }
}

const TRACKED = Object.values(LM);

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Interior angle at joint b (degrees) for segment a-b-c. */
function jointAngle(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const m = Math.hypot(v1.x, v1.y, v1.z) * Math.hypot(v2.x, v2.y, v2.z);
  if (m < 1e-9) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180) / Math.PI;
}

/** Rotation of a L→R body line around the vertical axis, degrees, from world landmarks. */
function horizontalRotation(left, right) {
  return (Math.atan2(right.z - left.z, right.x - left.x) * 180) / Math.PI;
}

function unwrapNear(angle, reference) {
  let a = angle;
  while (a - reference > 180) a -= 360;
  while (a - reference < -180) a += 360;
  return a;
}

export const PHASE = {
  IDLE: 'idle',
  ADDRESS: 'address',
  BACKSWING: 'backswing',
  TOP: 'top',
  DOWNSWING: 'downswing',
  IMPACT: 'impact',
  FINISH: 'finish',
  DONE: 'done',
};

const RELEASE_GAIN = 1.53;

export class SwingAnalyzer {
  /**
   * @param {object} opts
   * @param {'right'|'left'} [opts.handedness]
   * @param {number} [opts.speedCalibration] user gain 0.7–1.3 applied to CHS
   */
  constructor({ handedness = 'right', speedCalibration = 1.0 } = {}) {
    this.handedness = handedness;
    this.speedCalibration = speedCalibration;
    this.worldFilter = new LandmarkFilter(TRACKED, 1.7, 0.6);
    this.imageFilter = new LandmarkFilter(TRACKED, 1.7, 0.6);
    this.reset();
  }

  reset() {
    this.phase = PHASE.IDLE;
    this.samples = [];
    this.address = null;          // snapshot at address
    this.stillSince = null;
    this.phaseStart = 0;
    this.tBackswing = null;
    this.tTop = null;
    this.tImpact = null;
    this.topSample = null;
    this.result = null;
    this.cooldownUntil = 0;
    this.maxHandRise = 0;
    this.targetDir = 0;           // +1 / -1 in image-x: direction of the target
    this.scale = null;            // metres per normalized-image-unit (EMA, frozen mid-swing)
    this.worldFilter.reset();
    this.imageFilter.reset();
  }

  get lead() {
    // Lead side faces the target: left arm for a right-handed golfer.
    return this.handedness === 'right'
      ? { shoulder: LM.L_SHOULDER, elbow: LM.L_ELBOW, wrist: LM.L_WRIST }
      : { shoulder: LM.R_SHOULDER, elbow: LM.R_ELBOW, wrist: LM.R_WRIST };
  }

  /**
   * Feed one frame.
   * @param {number} t          seconds (monotonic)
   * @param {Array}  world      MediaPipe worldLandmarks[0] (metres, hip-centred)
   * @param {Array}  image      MediaPipe landmarks[0] (normalized image coords)
   * @returns {{phase:string, handSpeed:number, result:?object}}
   */
  update(t, world, image) {
    const w = this.worldFilter.apply(world, t);
    const im = this.imageFilter.apply(image, t);
    if (!w || !im) return { phase: this.phase, handSpeed: 0, result: null };

    const wristMidW = mid(w[LM.L_WRIST], w[LM.R_WRIST]);
    const hipMidIm = mid(im[LM.L_HIP], im[LM.R_HIP]);
    const shoulderMidW = mid(w[LM.L_SHOULDER], w[LM.R_SHOULDER]);
    const hipMidW = mid(w[LM.L_HIP], w[LM.R_HIP]);
    const shoulderMidIm = mid(im[LM.L_SHOULDER], im[LM.R_SHOULDER]);

    // Metres per normalized-image-unit, from torso length seen in both spaces.
    // Torso length (not shoulder width!) because in a face-on view the image
    // shoulder width collapses as the shoulders rotate at the top of the swing.
    // The scale is EMA-smoothed while the player stands still and FROZEN once
    // the swing starts — camera and golfer distance don't change mid-swing.
    const imTorso = dist2(shoulderMidIm, hipMidIm);
    if (imTorso > 0.02 && (this.phase === PHASE.IDLE || this.phase === PHASE.ADDRESS)) {
      const rawScale = dist3(shoulderMidW, hipMidW) / imTorso;
      this.scale = this.scale === null ? rawScale : 0.8 * this.scale + 0.2 * rawScale;
    }
    const scale = this.scale ?? 1;

    const sample = {
      t,
      wristMidW,
      // Absolute wrist position ≈ hip-relative world position + body translation
      // measured in image space and scaled to metres.
      wristAbs: {
        x: wristMidW.x + hipMidIm.x * scale,
        y: wristMidW.y + hipMidIm.y * scale,
        z: wristMidW.z,
      },
      shoulderRot: horizontalRotation(w[LM.L_SHOULDER], w[LM.R_SHOULDER]),
      hipRot: horizontalRotation(w[LM.L_HIP], w[LM.R_HIP]),
      headX: im[LM.NOSE].x * scale,
      headY: im[LM.NOSE].y * scale,
      hipX: hipMidIm.x * scale,
      leadElbow: jointAngle(w[this.lead.shoulder], w[this.lead.elbow], w[this.lead.wrist]),
      wristRadius: dist3(shoulderMidW, wristMidW),
      kneeFlex:
        180 -
        (jointAngle(w[LM.L_HIP], w[LM.L_KNEE], w[LM.L_ANKLE]) +
          jointAngle(w[LM.R_HIP], w[LM.R_KNEE], w[LM.R_ANKLE])) /
          2,
      wristAboveHead: im[LM.L_WRIST].y < im[LM.NOSE].y || im[LM.R_WRIST].y < im[LM.NOSE].y,
      handsBelowHips: mid(im[LM.L_WRIST], im[LM.R_WRIST]).y > hipMidIm.y,
      handsTogether: dist3(w[LM.L_WRIST], w[LM.R_WRIST]) < 0.22,
      visibility: Math.min(
        im[LM.L_SHOULDER].visibility, im[LM.R_SHOULDER].visibility,
        im[LM.L_WRIST].visibility, im[LM.R_WRIST].visibility,
        im[LM.L_HIP].visibility, im[LM.R_HIP].visibility
      ),
      speed: 0,
      vertVel: 0,
    };

    // Velocities via central difference over the last 3 samples.
    const n = this.samples.length;
    if (n >= 2) {
      const prev = this.samples[n - 2];
      const dt = t - prev.t;
      if (dt > 1e-3) {
        sample.speed = dist3(sample.wristAbs, prev.wristAbs) / dt;
        sample.vertVel = -(sample.wristAbs.y - prev.wristAbs.y) / dt; // +up (image y is down)
      }
    }

    this.samples.push(sample);
    if (this.samples.length > 400) this.samples.shift();

    this.step(sample, t);
    return { phase: this.phase, handSpeed: sample.speed, result: this.consumeResult() };
  }

  consumeResult() {
    const r = this.result;
    this.result = null;
    return r;
  }

  step(s, t) {
    switch (this.phase) {
      case PHASE.IDLE: {
        if (t < this.cooldownUntil) break;
        const ready =
          s.visibility > 0.5 && s.handsBelowHips && s.handsTogether && s.speed < 0.9;
        if (ready) {
          if (this.stillSince === null) this.stillSince = t;
          if (t - this.stillSince > 0.4) {
            this.address = {
              t,
              wristAbs: { ...s.wristAbs },
              shoulderRot: s.shoulderRot,
              hipRot: s.hipRot,
              headX: s.headX,
              headY: s.headY,
              hipX: s.hipX,
              kneeFlex: s.kneeFlex,
            };
            this.phase = PHASE.ADDRESS;
            this.phaseStart = t;
          }
        } else {
          this.stillSince = null;
        }
        break;
      }

      case PHASE.ADDRESS: {
        if (s.visibility < 0.35) { this.softReset(t); break; }
        // Keep the address baseline fresh while the player is still.
        if (s.speed < 0.5) {
          this.address.wristAbs = { ...s.wristAbs };
          this.address.shoulderRot = s.shoulderRot;
          this.address.hipRot = s.hipRot;
          this.address.headX = s.headX;
          this.address.headY = s.headY;
          this.address.hipX = s.hipX;
          this.address.kneeFlex = s.kneeFlex;
        }
        const rising = -(s.wristAbs.y - this.address.wristAbs.y); // metres, +up
        if (s.speed > 1.1 && rising > 0.06) {
          this.phase = PHASE.BACKSWING;
          this.phaseStart = t;
          this.tBackswing = t;
          this.maxHandRise = 0;
          this.backswingHeadSway = 0;
          this.backswingHipSway = 0;
          this.backswingDx = 0;
        }
        break;
      }

      case PHASE.BACKSWING: {
        const rise = -(s.wristAbs.y - this.address.wristAbs.y);
        this.maxHandRise = Math.max(this.maxHandRise, rise);
        this.backswingDx += s.wristAbs.x - this.samples[this.samples.length - 2].wristAbs.x;
        // Signed sways are resolved against target direction at TOP.
        this.backswingHeadSway = s.headX - this.address.headX;
        this.backswingHipSway = s.hipX - this.address.hipX;

        // False start: hands sank back down slowly.
        if (t - this.phaseStart > 2.5 && this.maxHandRise < 0.15) { this.softReset(t); break; }
        if (t - this.phaseStart > 3.5) { this.softReset(t); break; }

        // Top: hands were carried up, vertical velocity turns downward.
        if (this.maxHandRise > 0.25 && s.vertVel < -0.15) {
          // Hands moved toward the trail side during backswing → target is opposite.
          this.targetDir = this.backswingDx > 0 ? -1 : 1;
          this.tTop = t;
          this.topSample = s;
          this.phase = PHASE.DOWNSWING;
          this.phaseStart = t;
          this.peakSpeed = 0;
          this.tPeakSpeed = t;
          this.downswingRadiusSum = 0;
          this.downswingRadiusN = 0;
        }
        break;
      }

      case PHASE.DOWNSWING: {
        if (s.speed > this.peakSpeed) {
          this.peakSpeed = s.speed;
          this.tPeakSpeed = s.t;
        }
        this.downswingRadiusSum += s.wristRadius;
        this.downswingRadiusN += 1;

        const heightAboveAddress = -(s.wristAbs.y - this.address.wristAbs.y);
        // Impact: hands back down to address height with real speed.
        if (heightAboveAddress < 0.15 && s.speed > 2.0) {
          this.tImpact = t;
          this.impactSample = s;
          this.phase = PHASE.FINISH;
          this.phaseStart = t;
        }
        if (t - this.phaseStart > 1.2) { this.softReset(t); break; } // stalled — not a swing
        break;
      }

      case PHASE.FINISH: {
        if (t - this.phaseStart > 0.7) {
          this.finalize();
          this.phase = PHASE.IDLE;
          this.cooldownUntil = t + 2.0;
          this.stillSince = null;
        }
        break;
      }
    }
  }

  softReset(t) {
    this.phase = PHASE.IDLE;
    this.stillSince = null;
    this.cooldownUntil = t + 0.5;
  }

  /** 3-point parabolic refinement of the peak hand speed around the sampled max. */
  refinedPeakSpeed() {
    const idx = this.samples.findIndex((s) => s.t === this.tPeakSpeed);
    if (idx <= 0 || idx >= this.samples.length - 1) return this.peakSpeed;
    const y0 = this.samples[idx - 1].speed;
    const y1 = this.samples[idx].speed;
    const y2 = this.samples[idx + 1].speed;
    const denom = y0 - 2 * y1 + y2;
    if (Math.abs(denom) < 1e-9 || denom > 0) return y1;
    const delta = (0.5 * (y0 - y2)) / denom;
    return y1 - 0.25 * (y0 - y2) * delta; // vertex of the fitted parabola
  }

  /**
   * @param {number} clubLengthM
   * @returns {number} clubhead speed estimate, m/s
   */
  estimateClubheadSpeed(clubLengthM) {
    const vHand = this.refinedPeakSpeed();
    const rWrist = Math.min(
      0.75,
      Math.max(0.45, this.downswingRadiusN ? this.downswingRadiusSum / this.downswingRadiusN : 0.6)
    );
    const leverRatio = (rWrist + 0.95 * clubLengthM) / rWrist;
    const chs = vHand * leverRatio * RELEASE_GAIN * this.speedCalibration;
    return Math.min(67, Math.max(8, chs)); // clamp to 18–150 mph sanity range
  }

  finalize() {
    const a = this.address;
    const top = this.topSample;
    const imp = this.impactSample;
    const dir = this.targetDir || 1;

    const shoulderTurn = Math.abs(unwrapNear(top.shoulderRot, a.shoulderRot) - a.shoulderRot);
    const hipTurn = Math.abs(unwrapNear(top.hipRot, a.hipRot) - a.hipRot);
    const backswingS = this.tTop - this.tBackswing;
    const downswingS = this.tImpact - this.tTop;

    this.result = {
      timestamp: this.tImpact,
      peakHandSpeed: this.refinedPeakSpeed(),
      backswingS,
      downswingS,
      tempoRatio: downswingS > 0.02 ? backswingS / downswingS : 0,
      shoulderTurn,
      hipTurn,
      xFactor: Math.abs(shoulderTurn - hipTurn),
      leadArmFlexTop: 180 - top.leadElbow,
      leadElbowImpact: imp.leadElbow,
      // Signed toward-target displacements (m): + means toward the target.
      headSwayTarget: (top.headX - a.headX) * dir,
      hipSwayAway: (top.hipX - a.hipX) * -dir,
      headRise: -(imp.headY - a.headY), // + means head came UP from address→impact
      kneeFlexAddress: a.kneeFlex,
      overswing: top.wristAboveHead,
      // Deceleration: peak hand speed should arrive close to impact.
      peakToImpactMs: (this.tImpact - this.tPeakSpeed) * 1000,
      maxHandRise: this.maxHandRise,
    };
  }
}
