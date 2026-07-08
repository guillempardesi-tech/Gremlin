#!/usr/bin/env node
/**
 * End-to-end pipeline test with a synthetic swing.
 *
 * Generates an artificial MediaPipe landmark stream for a plausible
 * right-handed, face-on driver swing (0.75 s backswing, 0.25 s downswing,
 * 95° shoulder turn / 45° hip turn) at 60 fps, feeds it through
 * SwingAnalyzer → club model → flight simulator, and asserts the results
 * land in physically sensible ranges.
 *
 *   node tools/test-swing.mjs
 */

import { SwingAnalyzer, LM, PHASE } from '../js/swing.js';
import { getClub, launchConditions } from '../js/clubs.js';
import { simulateFlight, M_TO_YD, MPS_TO_MPH } from '../js/physics.js';
import { evaluateSwing } from '../js/advice.js';

const FPS = 60;
const DT = 1 / FPS;

// Body model, metres, hip-centred, y DOWN (MediaPipe convention).
const SHOULDER_Y = -0.50, SHOULDER_W = 0.40;
const HIP_W = 0.22;
const NOSE_Y = -0.68;
const KNEE_Y = 0.45, ANKLE_Y = 0.90;

function makeLandmarks(t) {
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));

  // Phase schedule (seconds)
  const T_ADDR = 1.0, T_BACK = 0.75, T_DOWN = 0.25, T_FOLLOW = 1.0;

  let wrist, shoulderRot = 0, hipRot = 0, headDx = 0;

  const addrWrist = { x: 0.10, y: 0.18, z: 0.28 };
  const topWrist = { x: 0.55, y: -0.75, z: 0.10 };
  const impWrist = { x: 0.02, y: 0.16, z: 0.28 };
  const finWrist = { x: -0.50, y: -0.70, z: 0.05 };

  const lerp3 = (a, b, u) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u });

  if (t < T_ADDR) {
    wrist = addrWrist;
  } else if (t < T_ADDR + T_BACK) {
    const u = (t - T_ADDR) / T_BACK;
    const e = 0.5 - 0.5 * Math.cos(Math.PI * u); // sine ease in-out
    wrist = lerp3(addrWrist, topWrist, e);
    shoulderRot = 95 * e;
    hipRot = 45 * e;
    headDx = 0.03 * e; // drifts slightly AWAY from target (target is -x)
  } else if (t < T_ADDR + T_BACK + T_DOWN) {
    const u = (t - T_ADDR + -T_BACK) / T_DOWN;
    const e = Math.pow(u, 2.2); // velocity peaks near impact
    wrist = lerp3(topWrist, impWrist, e);
    shoulderRot = 95 * (1 - e);
    hipRot = 45 * (1 - e * 1.4); // hips open past square
    headDx = 0.03 * (1 - u);
  } else {
    const u = Math.min(1, (t - T_ADDR - T_BACK - T_DOWN) / T_FOLLOW);
    const e = 1 - Math.pow(1 - u, 2.2);
    wrist = lerp3(impWrist, finWrist, e);
    shoulderRot = -60 * e;
    hipRot = -55 * e;
  }

  const sr = (shoulderRot * Math.PI) / 180;
  const hr = (hipRot * Math.PI) / 180;

  world[LM.NOSE] = { x: headDx, y: NOSE_Y, z: 0.05, visibility: 1 };
  world[LM.L_SHOULDER] = { x: -(SHOULDER_W / 2) * Math.cos(sr), y: SHOULDER_Y, z: (SHOULDER_W / 2) * Math.sin(sr), visibility: 1 };
  world[LM.R_SHOULDER] = { x: (SHOULDER_W / 2) * Math.cos(sr), y: SHOULDER_Y, z: -(SHOULDER_W / 2) * Math.sin(sr), visibility: 1 };
  world[LM.L_HIP] = { x: -(HIP_W / 2) * Math.cos(hr), y: 0, z: (HIP_W / 2) * Math.sin(hr), visibility: 1 };
  world[LM.R_HIP] = { x: (HIP_W / 2) * Math.cos(hr), y: 0, z: -(HIP_W / 2) * Math.sin(hr), visibility: 1 };

  // Legs: slight forward knee (≈20° flex).
  world[LM.L_KNEE] = { x: -0.11, y: KNEE_Y, z: -0.08, visibility: 1 };
  world[LM.R_KNEE] = { x: 0.11, y: KNEE_Y, z: -0.08, visibility: 1 };
  world[LM.L_ANKLE] = { x: -0.11, y: ANKLE_Y, z: 0, visibility: 1 };
  world[LM.R_ANKLE] = { x: 0.11, y: ANKLE_Y, z: 0, visibility: 1 };

  // Wrists together on the grip; elbows midway shoulder→wrist (straight arms).
  world[LM.L_WRIST] = { x: wrist.x - 0.02, y: wrist.y, z: wrist.z, visibility: 1 };
  world[LM.R_WRIST] = { x: wrist.x + 0.02, y: wrist.y, z: wrist.z, visibility: 1 };
  world[LM.L_ELBOW] = {
    x: (world[LM.L_SHOULDER].x + wrist.x) / 2,
    y: (world[LM.L_SHOULDER].y + wrist.y) / 2,
    z: (world[LM.L_SHOULDER].z + wrist.z) / 2,
    visibility: 1,
  };
  world[LM.R_ELBOW] = {
    x: (world[LM.R_SHOULDER].x + wrist.x) / 2,
    y: (world[LM.R_SHOULDER].y + wrist.y) / 2,
    z: (world[LM.R_SHOULDER].z + wrist.z) / 2,
    visibility: 1,
  };

  // Image landmarks: simple scaled projection of world (camera face-on).
  const image = world.map((p) => ({
    x: 0.5 + p.x * 0.3,
    y: 0.55 + p.y * 0.3,
    z: p.z,
    visibility: p.visibility,
  }));

  return { world, image };
}

// ── Run ──────────────────────────────────────────────────────────────────

const analyzer = new SwingAnalyzer({ handedness: 'right' });
const phasesSeen = new Set();
let result = null;

for (let t = 0; t < 3.6; t += DT) {
  const { world, image } = makeLandmarks(t);
  const out = analyzer.update(t, world, image);
  phasesSeen.add(out.phase);
  if (out.result) result = out.result;
}

let failures = 0;
function check(name, cond, actual) {
  const ok = Boolean(cond);
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${actual !== undefined ? `  (${actual})` : ''}`);
  if (!ok) failures++;
}

console.log('Phases seen:', [...phasesSeen].join(' → '));
check('reached ADDRESS', phasesSeen.has(PHASE.ADDRESS));
check('reached BACKSWING', phasesSeen.has(PHASE.BACKSWING));
check('reached DOWNSWING', phasesSeen.has(PHASE.DOWNSWING));
check('reached FINISH', phasesSeen.has(PHASE.FINISH));
check('swing result emitted', result !== null);

if (result) {
  console.log('\nMetrics:', JSON.stringify(result, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v), 2));

  check('tempo ratio ≈ 3:1', result.tempoRatio > 2.0 && result.tempoRatio < 4.5, result.tempoRatio.toFixed(2));
  check('shoulder turn ≈ 95°', Math.abs(result.shoulderTurn - 95) < 15, result.shoulderTurn.toFixed(1));
  check('hip turn ≈ 45°', Math.abs(result.hipTurn - 45) < 12, result.hipTurn.toFixed(1));
  check('X-Factor ≈ 50°', Math.abs(result.xFactor - 50) < 15, result.xFactor.toFixed(1));
  check('lead arm straight', result.leadArmFlexTop < 20, result.leadArmFlexTop.toFixed(1));
  check('head sway small & away', result.headSwayTarget < 0.05, result.headSwayTarget.toFixed(3));
  check('peak hand speed 6–14 m/s', result.peakHandSpeed > 6 && result.peakHandSpeed < 14, result.peakHandSpeed.toFixed(2));

  const club = getClub('driver');
  const chs = analyzer.estimateClubheadSpeed(club.lengthM);
  const chsMph = chs * MPS_TO_MPH;
  console.log(`\nClubhead speed estimate: ${chsMph.toFixed(1)} mph`);
  check('clubhead speed plausible (60–130 mph)', chsMph > 60 && chsMph < 130, chsMph.toFixed(1));

  const launch = launchConditions(club, chs);
  const flight = simulateFlight(launch);
  const carryYd = flight.carryM * M_TO_YD;
  console.log(
    `Driver flight: ball ${(launch.ballSpeedMps * MPS_TO_MPH).toFixed(0)} mph, ` +
      `launch ${launch.launchDeg}°, spin ${launch.spinRpm.toFixed(0)} rpm → ` +
      `carry ${carryYd.toFixed(0)} yd, total ${(flight.totalM * M_TO_YD).toFixed(0)} yd, ` +
      `apex ${(flight.apexM * M_TO_YD).toFixed(0)} yd, ${flight.flightTimeS.toFixed(1)} s`
  );
  check('carry plausible (120–320 yd)', carryYd > 120 && carryYd < 320, carryYd.toFixed(0));

  const review = evaluateSwing(result);
  console.log(`\nSwing score: ${review.score}/100`);
  for (const f of review.findings) console.log(`  [${f.severity}] ${f.title} — ${f.measured}`);
  check('review produced findings', review.findings.length >= 4, review.findings.length);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
