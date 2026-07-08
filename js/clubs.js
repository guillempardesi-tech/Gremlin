/**
 * Club database.
 *
 * Reference launch conditions are the published TrackMan PGA Tour averages
 * (clubhead speed, smash factor, launch angle, spin rate, carry). They anchor
 * the per-club launch model: the app measures YOUR clubhead speed from the
 * camera, then scales ball speed / spin from these references.
 *
 *  - Ball speed = clubhead speed x smash factor. Smash factor is club-specific
 *    (it falls with loft because more of the impact energy goes into spin and
 *    oblique deflection; the driver value ~1.48-1.50 reflects the USGA COR
 *    limit of 0.83).
 *  - Spin scales approximately linearly with clubhead speed for a given club
 *    (spin loft is a club property; tangential impact velocity ~ CHS).
 *  - Launch angle is treated as the club's reference dynamic-launch value.
 *
 * Lengths are standard men's spec converted to meters.
 */

export const CLUBS = [
  { id: 'driver', name: 'Driver',        loftDeg: 10.5, lengthM: 1.156, smash: 1.48, launchDeg: 10.9, spinRpm: 2686, chsRefMph: 113, carryRefYd: 275, totalRefYd: 297 },
  { id: '3w',     name: '3 Wood',        loftDeg: 15.0, lengthM: 1.092, smash: 1.48, launchDeg:  9.2, spinRpm: 3655, chsRefMph: 107, carryRefYd: 243, totalRefYd: 262 },
  { id: '5w',     name: '5 Wood',        loftDeg: 18.0, lengthM: 1.067, smash: 1.47, launchDeg:  9.4, spinRpm: 4350, chsRefMph: 103, carryRefYd: 230, totalRefYd: 246 },
  { id: 'hybrid', name: 'Hybrid',        loftDeg: 19.0, lengthM: 1.029, smash: 1.46, launchDeg: 10.2, spinRpm: 4437, chsRefMph: 100, carryRefYd: 225, totalRefYd: 238 },
  { id: '3i',     name: '3 Iron',        loftDeg: 21.0, lengthM: 0.991, smash: 1.45, launchDeg: 10.4, spinRpm: 4630, chsRefMph:  98, carryRefYd: 212, totalRefYd: 226 },
  { id: '4i',     name: '4 Iron',        loftDeg: 24.0, lengthM: 0.978, smash: 1.43, launchDeg: 11.0, spinRpm: 4836, chsRefMph:  96, carryRefYd: 203, totalRefYd: 213 },
  { id: '5i',     name: '5 Iron',        loftDeg: 27.0, lengthM: 0.965, smash: 1.41, launchDeg: 12.1, spinRpm: 5361, chsRefMph:  94, carryRefYd: 194, totalRefYd: 202 },
  { id: '6i',     name: '6 Iron',        loftDeg: 30.0, lengthM: 0.953, smash: 1.38, launchDeg: 14.1, spinRpm: 6231, chsRefMph:  92, carryRefYd: 183, totalRefYd: 189 },
  { id: '7i',     name: '7 Iron',        loftDeg: 34.0, lengthM: 0.940, smash: 1.33, launchDeg: 16.3, spinRpm: 7097, chsRefMph:  90, carryRefYd: 172, totalRefYd: 176 },
  { id: '8i',     name: '8 Iron',        loftDeg: 38.0, lengthM: 0.927, smash: 1.32, launchDeg: 18.1, spinRpm: 7998, chsRefMph:  87, carryRefYd: 160, totalRefYd: 164 },
  { id: '9i',     name: '9 Iron',        loftDeg: 42.0, lengthM: 0.914, smash: 1.28, launchDeg: 20.4, spinRpm: 8647, chsRefMph:  85, carryRefYd: 148, totalRefYd: 151 },
  { id: 'pw',     name: 'Pitching Wedge',loftDeg: 46.0, lengthM: 0.908, smash: 1.23, launchDeg: 24.2, spinRpm: 9304, chsRefMph:  83, carryRefYd: 136, totalRefYd: 139 },
  { id: 'gw',     name: 'Gap Wedge',     loftDeg: 50.0, lengthM: 0.902, smash: 1.18, launchDeg: 26.5, spinRpm: 9600, chsRefMph:  79, carryRefYd: 120, totalRefYd: 123 },
  { id: 'sw',     name: 'Sand Wedge',    loftDeg: 54.0, lengthM: 0.895, smash: 1.12, launchDeg: 28.5, spinRpm: 10000, chsRefMph: 76, carryRefYd: 105, totalRefYd: 108 },
  { id: 'lw',     name: 'Lob Wedge',     loftDeg: 58.0, lengthM: 0.889, smash: 1.06, launchDeg: 31.0, spinRpm: 10400, chsRefMph: 73, carryRefYd:  90, totalRefYd:  93 },
];

export function getClub(id) {
  return CLUBS.find((c) => c.id === id) || CLUBS[0];
}

const MPH_TO_MPS = 0.44704;

/**
 * Derive launch conditions for a measured clubhead speed.
 * @param {object} club   entry from CLUBS
 * @param {number} chsMps clubhead speed, m/s
 * @returns {{ ballSpeedMps:number, launchDeg:number, spinRpm:number }}
 */
export function launchConditions(club, chsMps) {
  const chsRefMps = club.chsRefMph * MPH_TO_MPS;
  const speedRatio = chsMps / chsRefMps;
  const ballSpeedMps = chsMps * club.smash;
  // Spin ~ proportional to clubhead speed at fixed spin loft (Penner 2003).
  const spinRpm = Math.min(13000, Math.max(600, club.spinRpm * speedRatio));
  return { ballSpeedMps, launchDeg: club.launchDeg, spinRpm };
}

export { MPH_TO_MPS };
