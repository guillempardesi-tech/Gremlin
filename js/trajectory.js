/**
 * Side-view ball-flight chart on <canvas>, with an animated replay.
 * Styling follows the app's chart tokens (see style.css :root).
 */

import { M_TO_YD } from './physics.js';

const COLORS = {
  surface: '#1a1a19',
  grid: '#2c2c2a',
  baseline: '#383835',
  muted: '#898781',
  ink: '#ffffff',
  inkSecondary: '#c3c2b7',
  series: '#3987e5',
  seriesWash: 'rgba(57, 135, 229, 0.10)',
};

export class TrajectoryView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.flight = null;
    this.units = 'yd';
    this.animStart = 0;
    this.raf = null;
    this.resize();
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
    this.draw(this.flight ? 1 : 0);
  }

  setUnits(units) {
    this.units = units;
    this.draw(this.flight ? 1 : 0);
  }

  show(flight) {
    this.flight = flight;
    // The canvas may have been display:none (zero-width) when constructed —
    // re-measure now that the results panel is visible.
    this.resize();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.animStart = performance.now();
    const animate = (now) => {
      // Replay at 2x real time.
      const progress = Math.min(1, ((now - this.animStart) / 1000) * 2 / flight.flightTimeS);
      this.draw(progress);
      if (progress < 1) this.raf = requestAnimationFrame(animate);
    };
    this.raf = requestAnimationFrame(animate);
  }

  toUnit(m) {
    return this.units === 'yd' ? m * M_TO_YD : m;
  }

  draw(progress = 0) {
    const { ctx, w, h } = this;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);

    const padL = 10, padR = 16, padT = 18, padB = 24;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    // Scale: keep x/y proportional-ish but prioritize fitting the carry.
    const maxX = this.flight ? Math.max(50, this.flight.totalM * 1.06) : 250;
    const maxY = this.flight ? Math.max(20, this.flight.apexM * 1.8) : 60;
    const sx = plotW / maxX;
    const sy = plotH / maxY;
    const X = (m) => padL + m * sx;
    const Y = (m) => padT + plotH - m * sy;

    // Distance gridlines (hairline, recessive) every 50 yd / m.
    const unitPerM = this.units === 'yd' ? M_TO_YD : 1;
    const stepU = maxX * unitPerM > 320 ? 100 : 50;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = COLORS.muted;
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    for (let u = stepU; u <= maxX * unitPerM; u += stepU) {
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

    if (!this.flight) {
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'center';
      ctx.fillText('Swing to see your ball flight', w / 2, h / 2);
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
      // Roll segment (secondary treatment — muted, thinner).
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
      ctx.textAlign = 'center';
      ctx.fillText(
        `apex ${this.toUnit(this.flight.apexM).toFixed(0)} ${this.units}`,
        X(apexPt.x),
        Y(apexPt.y) - 10
      );

      // Carry label at the landing point.
      ctx.fillStyle = COLORS.ink;
      ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
      const carryX = Math.min(X(this.flight.carryM), w - padR - 30);
      ctx.fillText(`${this.toUnit(this.flight.carryM).toFixed(0)} ${this.units}`, carryX, Y(0) - 8);
      ctx.textAlign = 'left';
    }
  }
}
