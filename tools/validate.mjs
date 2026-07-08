#!/usr/bin/env node
/**
 * Physics validation & calibration harness.
 *
 * Feeds the simulator the published TrackMan PGA Tour launch conditions
 * (ball speed, launch angle, spin) for every club and compares predicted
 * carry / apex / total against the published tour results.
 *
 * Usage:
 *   node tools/validate.mjs             # print validation table with current constants
 *   node tools/validate.mjs --calibrate # grid-search aero + roll constants, print best
 */

import { simulateFlight, AERO, ROLL, M_TO_YD } from '../js/physics.js';
import { CLUBS, MPH_TO_MPS } from '../js/clubs.js';

// Published tour references used as calibration targets. Ball speed derives
// from chsRef x smash. Apex targets (yd) where published: driver ~32, 7i ~32.
const APEX_TARGETS = { driver: 32, '7i': 32 };
const LAND_ANGLE_TARGETS = { driver: 38, '7i': 50 };

function run(club) {
  const ballSpeedMps = club.chsRefMph * MPH_TO_MPS * club.smash;
  return simulateFlight({
    ballSpeedMps,
    launchDeg: club.launchDeg,
    spinRpm: club.spinRpm,
  });
}

// Only TrackMan-anchored clubs count toward calibration error; 'est' clubs
// are interpolations and are printed for sanity but never scored.
const ANCHORED = CLUBS.filter((c) => c.ref === 'trackman');

function objective() {
  let err = 0;
  for (const club of ANCHORED) {
    const r = run(club);
    const carryYd = r.carryM * M_TO_YD;
    err += ((carryYd - club.carryRefYd) / club.carryRefYd) ** 2;
    if (APEX_TARGETS[club.id]) {
      const apexYd = r.apexM * M_TO_YD;
      err += 0.5 * ((apexYd - APEX_TARGETS[club.id]) / APEX_TARGETS[club.id]) ** 2;
    }
    if (LAND_ANGLE_TARGETS[club.id]) {
      err += 0.25 * ((r.landAngleDeg - LAND_ANGLE_TARGETS[club.id]) / LAND_ANGLE_TARGETS[club.id]) ** 2;
    }
  }
  return err;
}

function rollObjective() {
  let err = 0;
  for (const club of ANCHORED) {
    const r = run(club);
    const rollTgt = club.totalRefYd - club.carryRefYd;
    const rollYd = r.rollM * M_TO_YD;
    err += ((rollYd - rollTgt) / Math.max(3, rollTgt)) ** 2;
  }
  return err;
}

function calibrateAero() {
  let best = { err: Infinity };
  for (let cd0 = 0.18; cd0 <= 0.25; cd0 += 0.005) {
    for (let cd1 = 0.04; cd1 <= 0.4; cd1 += 0.02) {
      for (let clmax = 0.28; clmax <= 0.5; clmax += 0.01) {
        for (let clhalf = 0.08; clhalf <= 0.24; clhalf += 0.02) {
          AERO.CD0 = cd0; AERO.CD1 = cd1; AERO.CLMAX = clmax; AERO.CL_HALF = clhalf;
          const err = objective();
          if (err < best.err) best = { err, cd0, cd1, clmax, clhalf };
        }
      }
    }
  }
  AERO.CD0 = best.cd0; AERO.CD1 = best.cd1; AERO.CLMAX = best.clmax; AERO.CL_HALF = best.clhalf;

  // Local refinement, halving steps.
  let steps = { cd0: 0.0025, cd1: 0.01, clmax: 0.005, clhalf: 0.01 };
  for (let iter = 0; iter < 40; iter++) {
    let improved = false;
    for (const [key, prop] of [['cd0', 'CD0'], ['cd1', 'CD1'], ['clmax', 'CLMAX'], ['clhalf', 'CL_HALF']]) {
      for (const dir of [1, -1]) {
        const old = AERO[prop];
        AERO[prop] = old + dir * steps[key];
        const err = objective();
        if (err < best.err) { best = { ...best, err, [key]: AERO[prop] }; improved = true; }
        else AERO[prop] = old;
      }
    }
    if (!improved) {
      for (const k of Object.keys(steps)) steps[k] /= 2;
      if (steps.cd0 < 1e-5) break;
    }
  }
  return best;
}

function calibrateRoll() {
  let best = { err: Infinity };
  for (let a = 0.2; a <= 4; a += 0.1) {
    for (let th = 8; th <= 60; th += 2) {
      for (let sp = 2000; sp <= 20000; sp += 1000) {
        ROLL.A = a; ROLL.THETA0 = th; ROLL.SPIN0 = sp;
        const err = rollObjective();
        if (err < best.err) best = { err, a, th, sp };
      }
    }
  }
  ROLL.A = best.a; ROLL.THETA0 = best.th; ROLL.SPIN0 = best.sp;
  return best;
}

function table() {
  const rows = [];
  for (const club of CLUBS) {
    const r = run(club);
    rows.push({
      club: club.name,
      src: club.ref === 'trackman' ? 'TM' : 'est',
      'ball mph': (club.chsRefMph * club.smash).toFixed(1),
      'launch°': club.launchDeg,
      spin: club.spinRpm,
      'carry yd (sim)': (r.carryM * M_TO_YD).toFixed(1),
      'carry yd (ref)': club.carryRefYd,
      'err %': club.ref === 'trackman'
        ? (((r.carryM * M_TO_YD) / club.carryRefYd - 1) * 100).toFixed(1)
        : '—',
      'apex yd': (r.apexM * M_TO_YD).toFixed(1),
      'land°': r.landAngleDeg.toFixed(1),
      'roll yd (sim)': (r.rollM * M_TO_YD).toFixed(1),
      'roll yd (TM)': club.totalRefYd - club.carryRefYd,
      'time s': r.flightTimeS.toFixed(2),
    });
  }
  console.table(rows);
}

if (process.argv.includes('--calibrate')) {
  console.log('Calibrating aero constants against TrackMan tour data...');
  const a = calibrateAero();
  console.log('Best aero:', a);
  console.log('Calibrating roll model...');
  const r = calibrateRoll();
  console.log('Best roll:', r);
  console.log(`\nPaste into js/physics.js:
  CD0: ${AERO.CD0.toFixed(4)},
  CD1: ${AERO.CD1.toFixed(4)},
  CLMAX: ${AERO.CLMAX.toFixed(4)},
  CL_HALF: ${AERO.CL_HALF.toFixed(4)},
  ROLL: A=${ROLL.A.toFixed(2)}, THETA0=${ROLL.THETA0}, SPIN0=${ROLL.SPIN0}`);
  table();
} else {
  console.log('Validation with current constants (AERO):', AERO, 'ROLL:', ROLL);
  table();
}
