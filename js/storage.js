/**
 * Persistence — settings and the personal leaderboard survive restarts.
 *
 * localStorage when the environment allows it (normal browsers, file://),
 * with a transparent in-memory fallback for sandboxes that block storage
 * (some embedded iframes throw SecurityError on any localStorage access).
 */

const KEY = 'swinglab.v1';

let store = null;
try {
  const probe = '__swinglab_probe__';
  window.localStorage.setItem(probe, '1');
  window.localStorage.removeItem(probe);
  store = window.localStorage;
} catch {
  store = null;
}

/** True when data will actually survive a page reload. */
export const persistent = store !== null;

const memory = { data: null };

export function loadData() {
  if (store) {
    try {
      return JSON.parse(store.getItem(KEY)) ?? {};
    } catch {
      return {};
    }
  }
  return memory.data ?? {};
}

export function saveData(data) {
  memory.data = data;
  if (store) {
    try {
      store.setItem(KEY, JSON.stringify(data));
    } catch {
      // Quota or transient failure — memory copy still serves this session.
    }
  }
}

const LEADERBOARD_MAX = 10;

/**
 * Insert a shot into the leaderboard, keeping the longest carries first.
 * Returns a new array (never mutates).
 */
export function updateLeaderboard(list, entry) {
  return [...list, entry]
    .sort((a, b) => b.carryM - a.carryM || b.totalM - a.totalM)
    .slice(0, LEADERBOARD_MAX);
}

/** Longest carry on record for one club (0 if none). */
export function bestForClub(list, clubId) {
  let best = 0;
  for (const e of list) if (e.clubId === clubId && e.carryM > best) best = e.carryM;
  return best;
}
