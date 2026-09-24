/**
 * OCEANTRACE — Mini-map card (PLAN §6): domain thumbnail, red view bbox,
 * center coords readout "12.436° N, 72.118° E | Indian Ocean", scale 0/50/100 km.
 */
import { Camera, viewBoundsLL, domainWM, domainHM, unproject } from './camera';
import { getDomainM, getProjector } from '../geo';
import { polyXY } from '../caseView';
import { state } from '../state';
import type { Slick } from '../engine/slick';

export class MiniMap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private coordsEl: HTMLElement;
  /** click-to-center callback (model metres) — wired by main.ts */
  onCenter: ((x: number, y: number) => void) | null = null;
  private rect = { ox: 0, oy: 0, dw: 0, dh: 0 };

  constructor(canvas: HTMLCanvasElement, coordsEl: HTMLElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.coordsEl = coordsEl;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = canvas.clientWidth * dpr;
    this.canvas.height = canvas.clientHeight * dpr;
    this.ctx.scale(dpr, dpr);
    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const { ox, oy, dw, dh } = this.rect;
      if (px < ox || px > ox + dw || py < oy || py > oy + dh) return;
      const D = getDomainM();
      const x = D.xMin + ((px - ox) / dw) * domainWM();
      const y = D.yMin + ((oy + dh - py) / dh) * domainHM();
      this.onCenter?.(x, y);
    });
  }

  draw(cam: Camera, slick?: Slick): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    // domain box (preserve aspect)
    const pad = 10;
    const s = Math.min((w - 2 * pad) / domainWM(), (h - 2 * pad) / domainHM());
    const dw = domainWM() * s, dh = domainHM() * s;
    const ox = (w - dw) / 2, oy = (h - dh) / 2;
    ctx.fillStyle = 'rgba(10, 34, 64, 0.6)';
    ctx.fillRect(ox, oy, dw, dh);
    ctx.strokeStyle = 'rgba(0, 191, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, dw, dh);
    const D = getDomainM();
    const xToPx = (x: number): number => ox + ((x - D.xMin) / domainWM()) * dw;
    const yToPx = (y: number): number => oy + (1 - (y - D.yMin) / domainHM()) * dh;
    // case slick if projector is live; else engine KDE bbox; else decorative blob
    ctx.fillStyle = 'rgba(255, 51, 102, 0.4)';
    const casePoly = polyXY(state.tHours);
    if (casePoly.length >= 3) {
      ctx.beginPath();
      for (let i = 0; i < casePoly.length; i++) {
        const px = xToPx(casePoly[i].x), py = yToPx(casePoly[i].y);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    } else if (slick && slick.wetCount > 0) {
      const bx = xToPx(slick.bbox.minX);
      const by = yToPx(slick.bbox.maxY);
      const bw = Math.max(5, ((slick.bbox.maxX - slick.bbox.minX) / domainWM()) * dw);
      const bh = Math.max(4, ((slick.bbox.maxY - slick.bbox.minY) / domainHM()) * dh);
      ctx.beginPath();
      ctx.ellipse(bx + bw / 2, by + bh / 2, bw / 2, bh / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.ellipse(ox + dw * 0.44, oy + dh * 0.52, 14, 8, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // view bbox (red) — camera corners in metres, same space as the domain plate
    const a = unproject(cam, 0, cam.h);
    const b = unproject(cam, cam.w, 0);
    const bx0 = Math.max(ox, xToPx(a.x));
    const bx1 = Math.min(ox + dw, xToPx(b.x));
    const by0 = Math.max(oy, yToPx(b.y));
    const by1 = Math.min(oy + dh, yToPx(a.y));
    ctx.strokeStyle = '#ff3366';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(bx0, by0, Math.max(2, bx1 - bx0), Math.max(2, by1 - by0));
    this.rect = { ox, oy, dw, dh };
    // coords readout — center of current view
    const vb = viewBoundsLL(cam);
    const clon = (vb.lonMin + vb.lonMax) / 2;
    const clat = (vb.latMin + vb.latMax) / 2;
    const proj = getProjector();
    const sea = proj && proj.lat0 > 15 ? 'Arabian Sea' : 'Indian Ocean';
    this.coordsEl.textContent = `${clat.toFixed(3)}° N, ${clon.toFixed(3)}° E | ${sea}`;
    // scale bar sized to the live domain (toy 100 km is too wide for a SAR tile)
    const spanKm = domainWM() / 1000;
    const scaleKm = spanKm > 200 ? 100 : spanKm > 80 ? 50 : spanKm > 30 ? 20 : 10;
    const barPx = Math.min(dw * 0.7, scaleKm * 1000 * s);
    ctx.strokeStyle = 'rgba(214, 228, 255, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox, h - 6);
    ctx.lineTo(ox + barPx, h - 6);
    ctx.moveTo(ox, h - 9); ctx.lineTo(ox, h - 3);
    ctx.moveTo(ox + barPx, h - 9); ctx.lineTo(ox + barPx, h - 3);
    ctx.stroke();
    ctx.font = '8px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(127, 146, 179, 0.9)';
    ctx.fillText('0', ox - 2, h - 10);
    ctx.fillText(String(scaleKm / 2), ox + barPx / 2 - 4, h - 10);
    ctx.fillText(`${scaleKm} km`, ox + barPx + 3, h - 10);
  }
}
