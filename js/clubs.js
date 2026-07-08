/**
 * Club database — the full bag.
 *
 * Entries with ref:'trackman' carry the published TrackMan PGA Tour average
 * launch conditions (clubhead speed, smash factor, launch angle, spin, carry)
 * and are the anchors the physics engine was calibrated against. Entries with
 * ref:'est' are clubs TrackMan doesn't publish tour averages for (odd woods,
 * hybrids, long irons, high-loft wedges); their values are interpolated from
 * the anchored clubs by loft and length, staying monotonic through the bag.
 *
 *  - Ball speed = clubhead speed x smash factor. Smash falls with loft
 *    (more impact energy goes into spin and oblique deflection; the driver
 *    value ~1.48-1.50 reflects the USGA COR limit of 0.83).
 *  - Spin scales approximately linearly with clubhead speed for a given club
 *    (spin loft is a club property; tangential impact velocity ~ CHS).
 *  - Launch angle is the club's reference dynamic-launch value.
 *
 * Lengths are standard men's spec converted to meters.
 */

export const CLUBS = [
  // ── Woods ─────────────────────────────────────────────────────────────
  { id: 'driver', name: 'Driver',          cat: 'Woods',   loftDeg: 10.5, lengthM: 1.156, smash: 1.48, launchDeg: 10.9, spinRpm: 2686, chsRefMph: 113, carryRefYd: 275, totalRefYd: 297, ref: 'trackman' },
  { id: '2w',     name: '2 Wood (mini)',   cat: 'Woods',   loftDeg: 13.0, lengthM: 1.105, smash: 1.48, launchDeg:  9.6, spinRpm: 3100, chsRefMph: 109, carryRefYd: 255, totalRefYd: 273, ref: 'est' },
  { id: '3w',     name: '3 Wood',          cat: 'Woods',   loftDeg: 15.0, lengthM: 1.092, smash: 1.48, launchDeg:  9.2, spinRpm: 3655, chsRefMph: 107, carryRefYd: 243, totalRefYd: 262, ref: 'trackman' },
  { id: '4w',     name: '4 Wood',          cat: 'Woods',   loftDeg: 16.5, lengthM: 1.080, smash: 1.47, launchDeg:  9.3, spinRpm: 4000, chsRefMph: 105, carryRefYd: 236, totalRefYd: 252, ref: 'est' },
  { id: '5w',     name: '5 Wood',          cat: 'Woods',   loftDeg: 18.0, lengthM: 1.067, smash: 1.47, launchDeg:  9.4, spinRpm: 4350, chsRefMph: 103, carryRefYd: 230, totalRefYd: 246, ref: 'trackman' },
  { id: '7w',     name: '7 Wood',          cat: 'Woods',   loftDeg: 21.0, lengthM: 1.054, smash: 1.44, launchDeg: 10.4, spinRpm: 4900, chsRefMph: 101, carryRefYd: 214, totalRefYd: 224, ref: 'est' },
  { id: '9w',     name: '9 Wood',          cat: 'Woods',   loftDeg: 24.0, lengthM: 1.041, smash: 1.41, launchDeg: 11.4, spinRpm: 5500, chsRefMph:  99, carryRefYd: 200, totalRefYd: 208, ref: 'est' },
  // ── Hybrids ───────────────────────────────────────────────────────────
  { id: '2h',     name: '2 Hybrid',        cat: 'Hybrids', loftDeg: 17.0, lengthM: 1.041, smash: 1.46, launchDeg:  9.7, spinRpm: 4100, chsRefMph: 101, carryRefYd: 219, totalRefYd: 233, ref: 'est' },
  { id: '3h',     name: '3 Hybrid',        cat: 'Hybrids', loftDeg: 19.0, lengthM: 1.029, smash: 1.46, launchDeg: 10.2, spinRpm: 4437, chsRefMph: 100, carryRefYd: 225, totalRefYd: 238, ref: 'trackman' },
  { id: '4h',     name: '4 Hybrid',        cat: 'Hybrids', loftDeg: 22.0, lengthM: 1.016, smash: 1.44, launchDeg: 11.0, spinRpm: 4900, chsRefMph:  98, carryRefYd: 203, totalRefYd: 212, ref: 'est' },
  { id: '5h',     name: '5 Hybrid',        cat: 'Hybrids', loftDeg: 25.0, lengthM: 1.003, smash: 1.42, launchDeg: 12.0, spinRpm: 5400, chsRefMph:  96, carryRefYd: 192, totalRefYd: 199, ref: 'est' },
  // ── Irons ─────────────────────────────────────────────────────────────
  { id: '1i',     name: '1 Iron',          cat: 'Irons',   loftDeg: 16.0, lengthM: 1.016, smash: 1.47, launchDeg:  9.0, spinRpm: 3900, chsRefMph: 100, carryRefYd: 219, totalRefYd: 235, ref: 'est' },
  { id: '2i',     name: '2 Iron',          cat: 'Irons',   loftDeg: 18.0, lengthM: 1.003, smash: 1.46, launchDeg:  9.8, spinRpm: 4250, chsRefMph:  99, carryRefYd: 214, totalRefYd: 228, ref: 'est' },
  { id: '3i',     name: '3 Iron',          cat: 'Irons',   loftDeg: 21.0, lengthM: 0.991, smash: 1.45, launchDeg: 10.4, spinRpm: 4630, chsRefMph:  98, carryRefYd: 212, totalRefYd: 226, ref: 'trackman' },
  { id: '4i',     name: '4 Iron',          cat: 'Irons',   loftDeg: 24.0, lengthM: 0.978, smash: 1.43, launchDeg: 11.0, spinRpm: 4836, chsRefMph:  96, carryRefYd: 203, totalRefYd: 213, ref: 'trackman' },
  { id: '5i',     name: '5 Iron',          cat: 'Irons',   loftDeg: 27.0, lengthM: 0.965, smash: 1.41, launchDeg: 12.1, spinRpm: 5361, chsRefMph:  94, carryRefYd: 194, totalRefYd: 202, ref: 'trackman' },
  { id: '6i',     name: '6 Iron',          cat: 'Irons',   loftDeg: 30.0, lengthM: 0.953, smash: 1.38, launchDeg: 14.1, spinRpm: 6231, chsRefMph:  92, carryRefYd: 183, totalRefYd: 189, ref: 'trackman' },
  { id: '7i',     name: '7 Iron',          cat: 'Irons',   loftDeg: 34.0, lengthM: 0.940, smash: 1.33, launchDeg: 16.3, spinRpm: 7097, chsRefMph:  90, carryRefYd: 172, totalRefYd: 176, ref: 'trackman' },
  { id: '8i',     name: '8 Iron',          cat: 'Irons',   loftDeg: 38.0, lengthM: 0.927, smash: 1.32, launchDeg: 18.1, spinRpm: 7998, chsRefMph:  87, carryRefYd: 160, totalRefYd: 164, ref: 'trackman' },
  { id: '9i',     name: '9 Iron',          cat: 'Irons',   loftDeg: 42.0, lengthM: 0.914, smash: 1.28, launchDeg: 20.4, spinRpm: 8647, chsRefMph:  85, carryRefYd: 148, totalRefYd: 151, ref: 'trackman' },
  // ── Wedges ────────────────────────────────────────────────────────────
  { id: 'pw',     name: 'Pitching Wedge',  cat: 'Wedges',  loftDeg: 46.0, lengthM: 0.908, smash: 1.23, launchDeg: 24.2, spinRpm: 9304, chsRefMph:  83, carryRefYd: 136, totalRefYd: 139, ref: 'trackman' },
  { id: 'gw',     name: 'Gap Wedge 50°',   cat: 'Wedges',  loftDeg: 50.0, lengthM: 0.902, smash: 1.18, launchDeg: 26.5, spinRpm: 9600, chsRefMph:  79, carryRefYd: 120, totalRefYd: 123, ref: 'est' },
  { id: 'sw',     name: 'Sand Wedge 54°',  cat: 'Wedges',  loftDeg: 54.0, lengthM: 0.895, smash: 1.12, launchDeg: 28.5, spinRpm: 10000, chsRefMph: 76, carryRefYd: 105, totalRefYd: 108, ref: 'est' },
  { id: 'lw',     name: 'Lob Wedge 58°',   cat: 'Wedges',  loftDeg: 58.0, lengthM: 0.889, smash: 1.06, launchDeg: 31.0, spinRpm: 10400, chsRefMph: 73, carryRefYd:  90, totalRefYd:  93, ref: 'est' },
  { id: '60w',    name: 'Lob Wedge 60°',   cat: 'Wedges',  loftDeg: 60.0, lengthM: 0.889, smash: 1.03, launchDeg: 32.5, spinRpm: 10500, chsRefMph: 71, carryRefYd:  80, totalRefYd:  82, ref: 'est' },
  { id: '64w',    name: 'High Lob 64°',    cat: 'Wedges',  loftDeg: 64.0, lengthM: 0.883, smash: 0.98, launchDeg: 34.5, spinRpm: 10700, chsRefMph: 69, carryRefYd:  68, totalRefYd:  70, ref: 'est' },
];

export const CLUB_CATEGORIES = ['Woods', 'Hybrids', 'Irons', 'Wedges'];

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
