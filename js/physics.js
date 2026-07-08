/**
 * Golf ball flight simulator.
 *
 * Integrates the full equations of motion for a spinning golf ball:
 *
 *   m dv/dt = m g  +  F_drag  +  F_magnus
 *   F_drag   = -1/2 rho Cd A |v| v
 *   F_magnus = +1/2 rho Cl A |v|^2  (spin_axis x v_hat)   [backspin lifts]
 *
 * Cd and Cl are functions of the spin ratio S = r*omega/|v| — the standard
 * non-dimensional parameter for a spinning sphere (Bearman & Harvey 1976;
 * Smits & Smith 1994; Penner 2003, "The physics of golf", Rep. Prog. Phys. 66).
 *
 *   Cd(S) = CD0 + CD1 * S              (pressure drag grows with spin)
 *   Cl(S) = CLMAX * S / (S + CL_HALF)  (saturating lift response)
 *
 * The four aerodynamic constants were CALIBRATED numerically (tools/validate.mjs)
 * so that, fed the published TrackMan PGA Tour launch conditions (ball speed,
 * launch angle, spin) for 12 clubs, the simulator reproduces the published tour
 * carry distances and apex heights. See README for the validation table.
 *
 * Spin decays exponentially in flight with time constant SPIN_TAU (~4%/s for a
 * driver, consistent with radar observations; Smits & Smith 1994).
 *
 * Integration: classic 4th-order Runge-Kutta, dt = 4 ms.
 */

export const BALL = {
  massKg: 0.04593,       // maximum legal mass (R&A/USGA rule: <= 45.93 g)
  radiusM: 0.021335,     // minimum legal diameter 42.67 mm
  areaM2: Math.PI * 0.021335 * 0.021335,
};

export const G = 9.80665;

// Aerodynamic model constants — calibrated against TrackMan tour data.
// (Values within the envelope of published wind-tunnel measurements for
// two-piece balls: Bearman & Harvey 1976, Smits & Smith 1994.)
export const AERO = {
  CD0: 0.2022,
  CD1: 0.4313,
  CLMAX: 0.5312,
  CL_HALF: 0.2125,
  SPIN_TAU: 25.0,        // s, exponential spin-decay time constant
};

// Ground-roll model: fitted to TrackMan tour carry-vs-total gaps
// (see tools/validate.mjs). Roll depends on the landing conditions the
// simulator itself predicts: horizontal land speed, land angle, land spin.
export const ROLL = {
  A: 3.9,                // s   (scales horizontal landing speed)
  THETA0: 38,            // deg (steeper landings kill roll exponentially)
  SPIN0: 4000,           // rpm (spin at landing brakes the ball)
};

/**
 * Air density from site conditions (ISA barometric formula + ideal gas law).
 * @param {number} temperatureC  ambient temperature, deg C
 * @param {number} altitudeM     altitude above sea level, m
 */
export function airDensity(temperatureC = 20, altitudeM = 0) {
  const p = 101325 * Math.pow(1 - 2.25577e-5 * Math.min(altitudeM, 11000), 5.25588); // Pa
  const T = temperatureC + 273.15;
  const R_SPECIFIC = 287.058; // J/(kg K), dry air
  return p / (R_SPECIFIC * T);
}

function coefficients(speed, omegaRadS) {
  const S = speed > 1e-6 ? (BALL.radiusM * omegaRadS) / speed : 0;
  const cd = AERO.CD0 + AERO.CD1 * Math.min(S, 0.45);
  const cl = (AERO.CLMAX * S) / (S + AERO.CL_HALF);
  return { cd, cl };
}

/**
 * Simulate a ball flight in the vertical plane (pure backspin; a face-on
 * camera cannot observe face-to-path sidespin, so the model assumes a
 * straight strike — see README "Honest limitations").
 *
 * @param {object} opts
 * @param {number} opts.ballSpeedMps  launch ball speed (m/s)
 * @param {number} opts.launchDeg    launch angle above horizontal (deg)
 * @param {number} opts.spinRpm      backspin at launch (rpm)
 * @param {number} [opts.rho]        air density (kg/m^3); default sea level 20 C
 * @returns {{
 *   carryM:number, rollM:number, totalM:number, apexM:number,
 *   flightTimeS:number, landAngleDeg:number, landSpeedMps:number,
 *   landSpinRpm:number, points:Array<{x:number,y:number,t:number}>
 * }}
 */
export function simulateFlight({ ballSpeedMps, launchDeg, spinRpm, rho = airDensity() }) {
  const dt = 0.004;
  const k = (0.5 * rho * BALL.areaM2) / BALL.massKg; // aero force / (m |v|^2) prefactor
  const launch = (launchDeg * Math.PI) / 180;

  // State: x, y, vx, vy. Spin handled as exponential decay (weak coupling).
  let x = 0;
  let y = 0;
  let vx = ballSpeedMps * Math.cos(launch);
  let vy = ballSpeedMps * Math.sin(launch);
  let t = 0;

  const omega0 = (spinRpm * 2 * Math.PI) / 60;

  const accel = (vxA, vyA, tA) => {
    const speed = Math.hypot(vxA, vyA);
    const omega = omega0 * Math.exp(-tA / AERO.SPIN_TAU);
    const { cd, cl } = coefficients(speed, omega);
    // Drag along -v; Magnus (backspin) perpendicular to v, rotated +90 deg
    // (unit vector (-vy, vx)/|v| lifts a ball moving in +x).
    const dragX = -k * cd * speed * vxA;
    const dragY = -k * cd * speed * vyA;
    const liftX = k * cl * speed * -vyA;
    const liftY = k * cl * speed * vxA;
    return { ax: dragX + liftX, ay: dragY + liftY - G };
  };

  const points = [{ x: 0, y: 0, t: 0 }];
  let apexM = 0;
  const MAX_T = 20;

  while (t < MAX_T) {
    // RK4 step
    const a1 = accel(vx, vy, t);
    const k1 = { dx: vx, dy: vy, dvx: a1.ax, dvy: a1.ay };

    const a2 = accel(vx + (dt / 2) * k1.dvx, vy + (dt / 2) * k1.dvy, t + dt / 2);
    const k2 = { dx: vx + (dt / 2) * k1.dvx, dy: vy + (dt / 2) * k1.dvy, dvx: a2.ax, dvy: a2.ay };

    const a3 = accel(vx + (dt / 2) * k2.dvx, vy + (dt / 2) * k2.dvy, t + dt / 2);
    const k3 = { dx: vx + (dt / 2) * k2.dvx, dy: vy + (dt / 2) * k2.dvy, dvx: a3.ax, dvy: a3.ay };

    const a4 = accel(vx + dt * k3.dvx, vy + dt * k3.dvy, t + dt);
    const k4 = { dx: vx + dt * k3.dvx, dy: vy + dt * k3.dvy, dvx: a4.ax, dvy: a4.ay };

    const newX = x + (dt / 6) * (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx);
    const newY = y + (dt / 6) * (k1.dy + 2 * k2.dy + 2 * k3.dy + k4.dy);
    const newVx = vx + (dt / 6) * (k1.dvx + 2 * k2.dvx + 2 * k3.dvx + k4.dvx);
    const newVy = vy + (dt / 6) * (k1.dvy + 2 * k2.dvy + 2 * k3.dvy + k4.dvy);

    if (newY < 0 && vy < 0) {
      // Interpolate the touchdown point between steps.
      const f = y / (y - newY);
      x = x + f * (newX - x);
      t += dt * f;
      vx = newVx;
      vy = newVy;
      y = 0;
      points.push({ x, y: 0, t });
      break;
    }

    x = newX; y = newY; vx = newVx; vy = newVy; t += dt;
    if (y > apexM) apexM = y;
    if (points.length === 0 || t - points[points.length - 1].t >= 0.05) {
      points.push({ x, y, t });
    }
  }

  const landSpeedMps = Math.hypot(vx, vy);
  const landAngleDeg = (Math.atan2(-vy, vx) * 180) / Math.PI;
  const landSpinRpm = spinRpm * Math.exp(-t / AERO.SPIN_TAU);

  // Empirical ground roll (medium-firm fairway), fitted to tour carry/total gaps.
  const vHoriz = Math.max(0, vx);
  const rollM = Math.max(
    0,
    ROLL.A * vHoriz * Math.exp(-landAngleDeg / ROLL.THETA0) * Math.exp(-landSpinRpm / ROLL.SPIN0)
  );

  return {
    carryM: x,
    rollM,
    totalM: x + rollM,
    apexM,
    flightTimeS: t,
    landAngleDeg,
    landSpeedMps,
    landSpinRpm,
    points,
  };
}

export const M_TO_YD = 1.09361;
export const MPS_TO_MPH = 2.23694;
