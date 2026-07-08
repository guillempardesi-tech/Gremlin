/**
 * SwingLab — application orchestration.
 *
 * Camera → MediaPipe PoseLandmarker (VIDEO mode, GPU) → SwingAnalyzer →
 * club model → ball-flight physics → results UI.
 */

import { CLUBS, getClub, launchConditions, MPH_TO_MPS } from './clubs.js';
import { simulateFlight, airDensity, M_TO_YD, MPS_TO_MPH } from './physics.js';
import { SwingAnalyzer, PHASE, LM } from './swing.js';
import { evaluateSwing } from './advice.js';
import { TrajectoryView } from './trajectory.js';

const MEDIAPIPE_VERSION = '0.10.14';
// CDN fallback chain. The explicit vision_bundle.mjs path matters: the
// package's "main" is the CJS bundle, which a bare package-root import
// may resolve to and then fail as an ES module.
const CDN_BASES = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`,
  `https://unpkg.com/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`,
];
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';

const $ = (sel) => document.querySelector(sel);

const state = {
  landmarker: null,
  running: false,
  mode: null, // 'camera' | 'video'
  analyzer: null,
  trajectory: null,
  units: 'yd', // 'yd' | 'm'
  lastVideoTime: -1,
  swingCount: 0,
  history: [],
};

// Skeleton connections we draw (torso + arms + legs).
const BONES = [
  [LM.L_SHOULDER, LM.R_SHOULDER], [LM.L_HIP, LM.R_HIP],
  [LM.L_SHOULDER, LM.L_HIP], [LM.R_SHOULDER, LM.R_HIP],
  [LM.L_SHOULDER, LM.L_ELBOW], [LM.L_ELBOW, LM.L_WRIST],
  [LM.R_SHOULDER, LM.R_ELBOW], [LM.R_ELBOW, LM.R_WRIST],
  [LM.L_HIP, LM.L_KNEE], [LM.L_KNEE, LM.L_ANKLE],
  [LM.R_HIP, LM.R_KNEE], [LM.R_KNEE, LM.R_ANKLE],
];

const PHASE_LABEL = {
  [PHASE.IDLE]: 'Waiting for address…',
  [PHASE.ADDRESS]: 'Address — ready',
  [PHASE.BACKSWING]: 'Backswing',
  [PHASE.TOP]: 'Top',
  [PHASE.DOWNSWING]: 'Downswing',
  [PHASE.IMPACT]: 'Impact',
  [PHASE.FINISH]: 'Finish',
  [PHASE.DONE]: 'Done',
};

function toSpeedUnit(mps) {
  return state.units === 'yd' ? mps * MPS_TO_MPH : mps * 3.6;
}
const speedUnitLabel = () => (state.units === 'yd' ? 'mph' : 'km/h');
function toDistUnit(m) {
  return state.units === 'yd' ? m * M_TO_YD : m;
}
const distUnitLabel = () => state.units;

// ── Setup ────────────────────────────────────────────────────────────────

async function loadModel() {
  const status = $('#loadStatus');
  status.textContent = 'Loading pose model…';
  let lastErr = null;
  for (const base of CDN_BASES) {
    try {
      const vision = await import(`${base}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${base}/wasm`);
      const options = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      try {
        state.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, options('GPU'));
      } catch {
        // No usable WebGL — CPU inference is slower but works everywhere.
        state.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, options('CPU'));
      }
      status.textContent = '';
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function buildClubSelect() {
  const sel = $('#clubSelect');
  for (const c of CLUBS) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
  sel.value = 'driver';
  sel.addEventListener('change', updateClubInfo);
  updateClubInfo();
}

function updateClubInfo() {
  const c = getClub($('#clubSelect').value);
  $('#clubInfo').textContent = `${c.loftDeg}° loft · ${(c.lengthM * 39.37).toFixed(1)}" · smash ${c.smash}`;
}

function makeAnalyzer() {
  state.analyzer = new SwingAnalyzer({
    handedness: $('#handedness').value,
    speedCalibration: parseFloat($('#calibration').value),
  });
}

// ── Video / camera plumbing ──────────────────────────────────────────────

async function startCamera() {
  const video = $('#video');
  stopVideoFile();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60, min: 24 },
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    state.mode = 'camera';
    beginSession();
  } catch (err) {
    $('#loadStatus').textContent =
      'Camera unavailable: ' + err.message + ' — you can still analyse an uploaded video.';
  }
}

function stopVideoFile() {
  const video = $('#video');
  if (video.src && video.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
  video.removeAttribute('src');
}

function stopCamera() {
  const video = $('#video');
  if (video.srcObject) {
    for (const track of video.srcObject.getTracks()) track.stop();
    video.srcObject = null;
  }
}

async function loadVideoFile(file) {
  stopCamera();
  stopVideoFile();
  const video = $('#video');
  video.src = URL.createObjectURL(file);
  video.loop = false;
  video.muted = true;
  await video.play();
  state.mode = 'video';
  beginSession();
}

function beginSession() {
  $('#startOverlay').classList.add('hidden');
  $('#stage').classList.remove('hidden');
  makeAnalyzer();
  if (!state.running) {
    state.running = true;
    scheduleFrame();
  }
  fitOverlay();
}

function fitOverlay() {
  const video = $('#video');
  const canvas = $('#overlay');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
}

function scheduleFrame() {
  const video = $('#video');
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    video.requestVideoFrameCallback(() => frame());
  } else {
    requestAnimationFrame(() => frame());
  }
}

function frame() {
  if (!state.running) return;
  const video = $('#video');
  if (video.readyState >= 2 && video.videoWidth > 0) {
    if (canvasNeedsResize(video)) fitOverlay();
    const tMs = performance.now();
    if (video.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = video.currentTime;
      let res;
      try {
        res = state.landmarker.detectForVideo(video, Math.round(tMs));
      } catch (e) {
        res = null;
      }
      handleResult(res, state.mode === 'video' ? video.currentTime : tMs / 1000);
    }
  }
  scheduleFrame();
}

function canvasNeedsResize(video) {
  const canvas = $('#overlay');
  return canvas.width !== video.videoWidth || canvas.height !== video.videoHeight;
}

// ── Per-frame handling ───────────────────────────────────────────────────

function handleResult(res, tSec) {
  const canvas = $('#overlay');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const has = res && res.landmarks && res.landmarks.length > 0;
  if (!has) {
    setPhaseBadge('No golfer detected', 'idle');
    return;
  }

  drawSkeleton(ctx, res.landmarks[0], canvas.width, canvas.height);

  const { phase, handSpeed, result } = state.analyzer.update(
    tSec,
    res.worldLandmarks[0],
    res.landmarks[0]
  );

  setPhaseBadge(PHASE_LABEL[phase] || phase, phase);
  $('#liveSpeed').textContent =
    handSpeed > 0.5 ? `hands ${toSpeedUnit(handSpeed).toFixed(0)} ${speedUnitLabel()}` : '';

  if (result) onSwingComplete(result);
}

function drawSkeleton(ctx, lms, w, h) {
  ctx.strokeStyle = 'rgba(57, 135, 229, 0.9)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const [a, b] of BONES) {
    const pa = lms[a], pb = lms[b];
    if (!pa || !pb || (pa.visibility ?? 1) < 0.4 || (pb.visibility ?? 1) < 0.4) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x * w, pa.y * h);
    ctx.lineTo(pb.x * w, pb.y * h);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  for (const i of [LM.L_WRIST, LM.R_WRIST]) {
    const p = lms[i];
    if (!p || (p.visibility ?? 1) < 0.4) continue;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function setPhaseBadge(label, phase) {
  const el = $('#phaseBadge');
  el.textContent = label;
  el.dataset.phase = phase;
}

// ── Swing completion → physics → UI ─────────────────────────────────────

function onSwingComplete(metrics) {
  const club = getClub($('#clubSelect').value);
  const chsMps = state.analyzer.estimateClubheadSpeed(club.lengthM);
  const launch = launchConditions(club, chsMps);
  const rho = airDensity(
    parseFloat($('#temperature').value) || 20,
    parseFloat($('#altitude').value) || 0
  );
  const flight = simulateFlight({ ...launch, rho });
  const review = evaluateSwing(metrics);

  state.swingCount += 1;
  state.history.unshift({ n: state.swingCount, club, chsMps, launch, flight, metrics, review });
  if (state.history.length > 20) state.history.pop();

  renderResults(state.history[0]);
  if (navigator.vibrate) navigator.vibrate(60);
}

function renderResults(swing) {
  const { club, chsMps, launch, flight, metrics, review } = swing;
  $('#results').classList.remove('hidden');

  // Hero: carry distance.
  $('#carryValue').textContent = toDistUnit(flight.carryM).toFixed(0);
  $('#carryUnit').textContent = distUnitLabel();
  $('#carryClub').textContent = `${club.name} · swing #${swing.n}`;

  const tiles = [
    ['Clubhead speed', `${toSpeedUnit(chsMps).toFixed(0)} ${speedUnitLabel()}`],
    ['Ball speed', `${toSpeedUnit(launch.ballSpeedMps).toFixed(0)} ${speedUnitLabel()}`],
    ['Total distance', `${toDistUnit(flight.totalM).toFixed(0)} ${distUnitLabel()}`],
    ['Apex', `${toDistUnit(flight.apexM).toFixed(0)} ${distUnitLabel()}`],
    ['Launch', `${launch.launchDeg.toFixed(1)}°`],
    ['Spin', `${Math.round(launch.spinRpm / 10) * 10} rpm`],
    ['Land angle', `${flight.landAngleDeg.toFixed(0)}°`],
    ['Flight time', `${flight.flightTimeS.toFixed(1)} s`],
    ['Tempo', metrics.tempoRatio ? `${metrics.tempoRatio.toFixed(1)} : 1` : '—'],
    ['X-Factor', `${metrics.xFactor.toFixed(0)}°`],
    ['Shoulder turn', `${metrics.shoulderTurn.toFixed(0)}°`],
    ['Hip turn', `${metrics.hipTurn.toFixed(0)}°`],
  ];
  const grid = $('#statGrid');
  grid.innerHTML = '';
  for (const [label, value] of tiles) {
    const tile = document.createElement('div');
    tile.className = 'stat';
    tile.innerHTML = `<div class="stat-label"></div><div class="stat-value"></div>`;
    tile.querySelector('.stat-label').textContent = label;
    tile.querySelector('.stat-value').textContent = value;
    grid.appendChild(tile);
  }

  // Trajectory replay.
  state.trajectory.show(flight);

  // Swing score + advice.
  $('#scoreValue').textContent = review.score;
  const list = $('#adviceList');
  list.innerHTML = '';
  for (const f of review.findings) {
    const li = document.createElement('li');
    li.className = `finding sev-${f.severity}`;
    const icon = { good: '✓', info: 'ℹ', minor: '△', major: '✕' }[f.severity];
    const sevLabel = { good: 'Good', info: 'Note', minor: 'Minor', major: 'Fix first' }[f.severity];
    li.innerHTML = `
      <div class="finding-head">
        <span class="finding-icon" aria-hidden="true"></span>
        <span class="finding-sev"></span>
        <span class="finding-title"></span>
        <span class="finding-measured"></span>
      </div>
      <p class="finding-detail"></p>
      ${f.drill ? '<p class="finding-drill"></p>' : ''}`;
    li.querySelector('.finding-icon').textContent = icon;
    li.querySelector('.finding-sev').textContent = sevLabel;
    li.querySelector('.finding-title').textContent = f.title;
    li.querySelector('.finding-measured').textContent = `${f.measured} (target ${f.target})`;
    li.querySelector('.finding-detail').textContent = f.detail;
    if (f.drill) li.querySelector('.finding-drill').textContent = `Drill: ${f.drill}`;
    list.appendChild(li);
  }

  renderHistory();
}

function renderHistory() {
  const tbody = $('#historyBody');
  tbody.innerHTML = '';
  for (const s of state.history) {
    const tr = document.createElement('tr');
    const cells = [
      `#${s.n}`,
      s.club.name,
      `${toSpeedUnit(s.chsMps).toFixed(0)} ${speedUnitLabel()}`,
      `${toDistUnit(s.flight.carryM).toFixed(0)} ${distUnitLabel()}`,
      `${toDistUnit(s.flight.totalM).toFixed(0)} ${distUnitLabel()}`,
      `${s.review.score}`,
    ];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  $('#historyWrap').classList.toggle('hidden', state.history.length === 0);
}

// ── Wire-up ──────────────────────────────────────────────────────────────

async function init() {
  buildClubSelect();
  state.trajectory = new TrajectoryView($('#trajCanvas'));
  window.addEventListener('resize', () => state.trajectory.resize());

  $('#startCamera').addEventListener('click', async () => {
    $('#loadStatus').textContent = '';
    try {
      if (!state.landmarker) await loadModel();
      await startCamera();
    } catch (e) {
      $('#loadStatus').textContent = 'Failed to load pose model: ' + e.message;
    }
  });

  $('#videoFile').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    $('#loadStatus').textContent = '';
    try {
      if (!state.landmarker) await loadModel();
      await loadVideoFile(file);
    } catch (e) {
      $('#loadStatus').textContent = 'Failed: ' + e.message;
    }
  });

  $('#unitToggle').addEventListener('change', (ev) => {
    state.units = ev.target.checked ? 'm' : 'yd';
    state.trajectory.setUnits(state.units);
    if (state.history.length) renderResults(state.history[0]);
  });

  $('#mirrorToggle').addEventListener('change', (ev) => {
    $('#stage').classList.toggle('mirrored', ev.target.checked);
  });

  for (const id of ['handedness', 'calibration']) {
    $('#' + id).addEventListener('change', () => makeAnalyzer());
  }
  $('#calibration').addEventListener('input', () => {
    $('#calibrationValue').textContent = `${Math.round(parseFloat($('#calibration').value) * 100)}%`;
  });

  $('#settingsToggle').addEventListener('click', () => {
    $('#settingsPanel').classList.toggle('hidden');
  });
}

init();
