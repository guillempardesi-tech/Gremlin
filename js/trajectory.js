/**
 * Side-view ball-flight chart on <canvas>: animated replay, hover crosshair
 * with tooltip, and a gold personal-best marker for the selected club.
 * Colors stay in sync with the tokens in css/style.css.
 */

import { M_TO_YD } from './physics.js';

const COLORS = {
  surface: '#131a14',
  ground: 'rgba(63, 92, 62, 0.14)',
  grid: '#233024',
  baseline: '#3a4a3c',
  muted: '#83917f',
  ink: '#f2f5ef',
  inkSecondary: '#c3cdbf',
  series: '#3987e5',
  seriesWash: 'rgba(57, 135, 229, 0.10)',
  gold: '#d8b46a',
  goldSoft: 'rgba(216, 180, 106, 0.55)',
};

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export class TrajectoryView {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} [tipEl] absolutely-positioned tooltip element
   */
  constructor(canvas, tipEl = null) {
    this.canvas = canvas;
    this.tip = tipEl;
    this.ctx = canvas.getContext('2d');
    this.flight = null;
    this.units = 'yd';
    this.pbCarryM = 0;      // personal best for the selected club (0 = none)
    this.animStart = 0;
    this.raf = null;
    this.done = false;
    this.hover = null;
    this.resize();

    canvas.addEventListener('pointermove', (ev) => this.onPointer(ev));
    canvas.addEventListener('pointerleave', () => this.clearHover());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
    // Only render the completed flight if the replay has finished — show()
    // calls resize() right before animating, and drawing the final frame
    // here would flash the full path for one frame.
    this.draw(this.flight && this.done ? 1 : 0);
  }

  setUnits(units) {
    this.units = units;
    this.draw(this.flight && this.done ? 1 : 0);
  }

  /** Personal-best carry (m) to mark on the ground line; 0 hides the marker. */
  setPB(carryM) {
    this.pbCarryM = carryM || 0;
  }

  show(flight) {
    this.flight = flight;
    this.done = false;
    this.hover = null;
    if (this.tip) this.tip.classList.add('hidden');
    // The canvas may have been display:none (zero-width) when constructed —
    // re-measure now that the results panel is visible.
    this.resize();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.animStart = performance.now();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      this.done = true;
      this.draw(1);
      return;
    }
    const animate = (now) => {
      // Replay at 2x real time.
      const progress = Math.min(1, ((now - this.animStart) / 1000) * 2 / flight.flightTimeS);
      this.draw(progress);
      if (progress < 1) this.raf = requestAnimationFrame(animate);
      else this.done = true;
    };
    this.raf = requestAnimationFrame(animate);
  }

  toUnit(m) {
    return this.units === 'yd' ? m * M_TO_YD : m;
  }

  onPointer(ev) {
    if (!this.flight || !this.done || !this.layout) return;
    const rect = this.canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const meters = (px - this.layout.padL) / this.layout.sx;
    const pts = this.flight.points;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.x - meters) < Math.abs(best.x - meters)) best = p;
    this.hover = best;
    this.draw(1);
    if (this.tip) {
      const u = this.units;
      this.tip.textContent =
        `${this.toUnit(best.x).toFixed(0)} ${u} out · ` +
        `${this.toUnit(best.y).toFixed(0)} ${u} high · ${best.t.toFixed(1)} s`;
      this.tip.classList.remove('hidden');
      const tx = this.layout.padL + best.x * this.layout.sx;
      const clampedX = Math.min(Math.max(tx, 70), this.w - 80);
      this.tip.style.left = `${clampedX}px`;
      this.tip.style.top = `${this.Y(best.y) - 34}px`;
    }
  }

  clearHover() {
    this.hover = null;
    if (this.tip) this.tip.classList.add('hidden');
    if (this.flight && this.done) this.draw(1);
  }

  X(m) { return this.layout.padL + m * this.layout.sx; }
  Y(m) { return this.layout.padT + this.layout.plotH - m * this.layout.sy; }

  draw(progress = 0) {
    const { ctx, w, h } = this;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);

    const padL = 10, padR = 16, padT = 18, padB = 24;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const reach = this.flight
      ? Math.max(50, Math.max(this.flight.totalM, this.pbCarryM) * 1.06)
      : 250;
    const maxY = this.flight ? Math.max(20, this.flight.apexM * 1.8) : 60;
    const sx = plotW / reach;
    const sy = plotH / maxY;
    this.layout = { padL, padT, plotH, sx, sy };
    const X = (m) => this.X(m);
    const Y = (m) => this.Y(m);

    // Turf wash under the ground line.
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(padL, Y(0), plotW, h - padB - Y(0) + 6);

    // Distance gridlines (hairline, recessive) every 50 yd / m.
    const unitPerM = this.units === 'yd' ? M_TO_YD : 1;
    const stepU = reach * unitPerM > 320 ? 100 : 50;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = COLORS.muted;
    ctx.font = `11px ${FONT}`;
    ctx.textAlign = 'center';
    for (let u = stepU; u <= reach * unitPerM; u += stepU) {
      const xPix = X(u / unitPerM);
      ctx.beginPath();
      ctx.moveTo(xPix, padT);
      ctx.lineTo(xPix, padT + plotH);
      ctx.stroke();
      ctx.fillText(`${u}`, xPix, h - 8);
    }
    ctx.textAlign = 'left';
    ctx.fillText(this.units === 'yd' ? 'yards' : 'metres', padL, h - 8);

    // Ground baseline.
    ctx.strokeStyle = COLORS.baseline;
    ctx.beginPath();
    ctx.moveTo(padL, Y(0) + 0.5);
    ctx.lineTo(w - padR, Y(0) + 0.5);
    ctx.stroke();

    // Personal-best marker (gold flag on the ground line).
    if (this.pbCarryM > 1) {
      const px = X(this.pbCarryM);
      ctx.strokeStyle = COLORS.goldSoft;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, Y(0));
      ctx.lineTo(px, Y(0) - 26);
      ctx.stroke();
      ctx.fillStyle = COLORS.gold;
      ctx.beginPath();
      ctx.moveTo(px, Y(0) - 26);
      ctx.lineTo(px + 9, Y(0) - 21.5);
      ctx.lineTo(px, Y(0) - 17);
      ctx.closePath();
      ctx.fill();
      ctx.font = `10px ${FONT}`;
      ctx.fillStyle = COLORS.goldSoft;
      ctx.textAlign = 'center';
      ctx.fillText(`best ${this.toUnit(this.pbCarryM).toFixed(0)}`, px, Y(0) - 32);
      ctx.textAlign = 'left';
    }

    if (!this.flight) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = `12px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('Your ball flight will trace here', w / 2, h / 2);
      ctx.textAlign = 'left';
      return;
    }

    const pts = this.flight.points;
    const lastIdx = Math.max(1, Math.floor(progress * (pts.length - 1)));

    // Area wash under the flown portion.
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    for (let i = 0; i <= lastIdx; i++) ctx.lineTo(X(pts[i].x), Y(pts[i].y));
    ctx.lineTo(X(pts[lastIdx].x), Y(0));
    ctx.closePath();
    ctx.fillStyle = COLORS.seriesWash;
    ctx.fill();

    // Flight path: 2px line, round joins.
    ctx.beginPath();
    ctx.moveTo(X(pts[0].x), Y(pts[0].y));
    for (let i = 1; i <= lastIdx; i++) ctx.lineTo(X(pts[i].x), Y(pts[i].y));
    ctx.strokeStyle = COLORS.series;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Ball marker with surface ring.
    const ball = pts[lastIdx];
    ctx.beginPath();
    ctx.arc(X(ball.x), Y(ball.y), 6, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.surface;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(X(ball.x), Y(ball.y), 4, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.series;
    ctx.fill();

    if (progress >= 1) {
      // Roll segment (secondary treatment — muted, on the ground).
      if (this.flight.rollM > 0.5) {
        ctx.beginPath();
        ctx.moveTo(X(this.flight.carryM), Y(0));
        ctx.lineTo(X(this.flight.totalM), Y(0));
        ctx.strokeStyle = COLORS.muted;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Apex marker + direct label (text tokens, never series color).
      const apexPt = pts.reduce((a, b) => (b.y > a.y ? b : a));
      ctx.beginPath();
      ctx.arc(X(apexPt.x), Y(apexPt.y), 5, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.surface;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(X(apexPt.x), Y(apexPt.y), 3, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.series;
      ctx.fill();
      ctx.fillStyle = COLORS.inkSecondary;
      ctx.font = `11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(
        `apex ${this.toUnit(this.flight.apexM).toFixed(0)} ${this.units}`,
        X(apexPt.x),
        Y(apexPt.y) - 10
      );

      // Carry label at the landing point.
      ctx.fillStyle = COLORS.ink;
      ctx.font = `600 12px ${FONT}`;
      const carryX = Math.min(X(this.flight.carryM), w - padR - 30);
      ctx.fillText(`${this.toUnit(this.flight.carryM).toFixed(0)} ${this.units}`, carryX, Y(0) - 8);
      ctx.textAlign = 'left';

      // Hover crosshair.
      if (this.hover) {
        const hx = X(this.hover.x), hy = Y(this.hover.y);
        ctx.strokeStyle = COLORS.baseline;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hx + 0.5, padT);
        ctx.lineTo(hx + 0.5, padT + plotH);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hx, hy, 7, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.surface;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.series;
        ctx.fill();
      }
    }
  }
}
