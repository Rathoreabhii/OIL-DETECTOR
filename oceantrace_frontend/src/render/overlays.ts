/**
 * OCEANTRACE — All map overlay layers (PLAN §5 draw order).
 *
 * base map graticule → current arrows → wind arrows → SAR overlay → spill polygon
 * → spill boundary → backward/forward trajectories → source rings → vessel tracks
 * → vessels (+labels) → particles → uncertainty ellipse → suspect link (animated).
 * Weather = forecast cloud swirls (toggle). Every layer gated by its toggle.
 */
import { Camera, project, viewBoundsLL } from './camera';
import { drawSatelliteTiles } from '../tiles';
import { LayerKey, state } from '../state';
import { OceanEngine, T_DET_S, T_SRC_EPOCH_MS, Investigation } from '../engine/engine';
import { getDomainM, getProjector } from '../geo';
import { caseCentroid, caseData, caseOrigin, dischargeHours, oilExistsAt, pathXY, polyXY, rankedVessels, sarImage, trackXY, vesselAtHours } from '../caseView';
import { sampleWind, sampleCurrent, W0 } from '../engine/fields';
import { Slick } from '../engine/slick';
import { Vessel, posAt, speedAtKn, sampleTrack } from '../engine/vessels';

const WIND_BUF = new Float64Array(2);
const CUR_BUF = new Float64Array(2);
const POS_BUF = new Float64Array(2);
const TRACK = { xs: [] as number[], ys: [] as number[] };

/** Live SAR tile, or the toy Arabian Sea box when no projector is set. */
function geoExtent(): { latMin: number; latMax: number; lonMin: number; lonMax: number } {
  const p = getProjector();
  if (p) {
    const d = getDomainM();
    return {
      latMin: p.yToLat(d.yMin),
      latMax: p.yToLat(d.yMax),
      lonMin: p.xToLon(d.xMin),
      lonMax: p.xToLon(d.xMax),
    };
  }
  return { latMin: 11.5, latMax: 13.5, lonMin: 70.5, lonMax: 73.5 };
}

function llToXY(lon: number, lat: number): { x: number; y: number } {
  const p = getProjector();
  if (p) return { x: p.lonToX(lon), y: p.latToY(lat) };
  return {
    x: (lon - 72) * 111.32 * Math.cos((12 * Math.PI) / 180) * 1000,
    y: (lat - 12.5) * 111.32 * 1000
  };
}

function gratStep(span: number): number {
  if (span >= 2) return 0.5;
  if (span >= 0.8) return 0.2;
  if (span >= 0.3) return 0.1;
  if (span >= 0.1) return 0.05;
  return 0.02;
}

function gratTicks(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  const n0 = Math.ceil(min / step - 1e-9);
  const n1 = Math.floor(max / step + 1e-9);
  for (let n = n0; n <= n1; n++) out.push(n * step);
  return out;
}

/* ---------------- Base map: graticule + coastline hints ---------------- */
export function drawBaseMap(ctx: CanvasRenderingContext2D, cam: Camera): void {
  const D = getDomainM();
  const { sx: x0, sy: yTop } = project(cam, D.xMin, D.yMax);
  const { sx: x1 } = project(cam, D.xMax, D.yMax);
  const { sy: yBot } = project(cam, D.xMin, D.yMin);
  const proj = getProjector();
  if (proj) {
    const vb = viewBoundsLL(cam);
    const pad = 0.12;
    drawSatelliteTiles(
      ctx, cam, project,
      (lon) => proj.lonToX(lon), (lat) => proj.latToY(lat),
      vb.lonMin - pad, vb.latMin - pad, vb.lonMax + pad, vb.latMax + pad,
      proj.lat0
    );
  } else {
    ctx.fillStyle = 'rgba(9, 22, 44, 0.55)';
    ctx.fillRect(x0, yTop, x1 - x0, yBot - yTop);
  }
  const ext = geoExtent();
  const lonStep = gratStep(ext.lonMax - ext.lonMin);
  const latStep = gratStep(ext.latMax - ext.latMin);
  const lons = gratTicks(ext.lonMin, ext.lonMax, lonStep);
  const lats = gratTicks(ext.latMin, ext.latMax, latStep);
  ctx.strokeStyle = 'rgba(95, 141, 190, 0.16)';
  ctx.beginPath();
  for (const lon of lons) {
    const p = project(cam, llToXY(lon, ext.latMin).x, 0);
    ctx.moveTo(p.sx, yTop); ctx.lineTo(p.sx, yBot);
  }
  for (const lat of lats) {
    const p = project(cam, 0, llToXY(ext.lonMin, lat).y);
    ctx.moveTo(x0, p.sy); ctx.lineTo(x1, p.sy);
  }
  ctx.stroke();
  const lonDec = lonStep < 0.1 ? 2 : 1;
  const latDec = latStep < 0.1 ? 2 : 1;
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(127, 146, 179, 0.75)';
  for (const lon of lons) {
    const p = project(cam, llToXY(lon, ext.latMin).x, 0);
    ctx.fillText(`${lon.toFixed(lonDec)}°E`, p.sx + 3, yBot - 5);
  }
  for (const lat of lats) {
    const p = project(cam, 0, llToXY(ext.lonMin, lat).y);
    ctx.fillText(`${lat.toFixed(latDec)}°N`, x0 + 4, p.sy - 4);
  }
}

/* ---------------- Current + wind arrow fields ---------------- */
export function drawCurrents(ctx: CanvasRenderingContext2D, cam: Camera, eng: OceanEngine, t: number): void {
  const ext = geoExtent();
  const stepLon = Math.max(0.04, (ext.lonMax - ext.lonMin) / 8);
  const stepLat = Math.max(0.04, (ext.latMax - ext.latMin) / 7);
  ctx.lineWidth = 1.3;
  for (let lat = ext.latMin + stepLat * 0.35; lat <= ext.latMax - stepLat * 0.15; lat += stepLat) {
    for (let lon = ext.lonMin + stepLon * 0.35; lon <= ext.lonMax - stepLon * 0.15; lon += stepLon) {
      const { x, y } = llToXY(lon, lat);
      sampleCurrent(eng.noise, x, y, t, CUR_BUF);
      const sp = Math.hypot(CUR_BUF[0], CUR_BUF[1]);
      const p = project(cam, x, y);
      drawArrow(ctx, p.sx, p.sy, CUR_BUF[0], CUR_BUF[1], 10 + sp * 26, `rgba(25, 227, 255, ${0.25 + Math.min(0.45, sp * 1.4)})`);
    }
  }
}

export function drawWind(ctx: CanvasRenderingContext2D, cam: Camera, eng: OceanEngine, t: number): void {
  const ext = geoExtent();
  const stepLon = Math.max(0.05, (ext.lonMax - ext.lonMin) / 5);
  const stepLat = Math.max(0.05, (ext.latMax - ext.latMin) / 4);
  ctx.lineWidth = 1.2;
  for (let lat = ext.latMin + stepLat * 0.4; lat <= ext.latMax - stepLat * 0.15; lat += stepLat) {
    for (let lon = ext.lonMin + stepLon * 0.4; lon <= ext.lonMax - stepLon * 0.15; lon += stepLon) {
      const { x, y } = llToXY(lon, lat);
      sampleWind(eng.noise, x, y, t, WIND_BUF);
      const p = project(cam, x, y);
      drawArrow(ctx, p.sx, p.sy, WIND_BUF[0], WIND_BUF[1], 9 + (Math.hypot(WIND_BUF[0], WIND_BUF[1]) / W0) * 14, 'rgba(232, 244, 255, 0.5)');
    }
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, ux: number, uy: number, len: number, color: string): void {
  const m = Math.hypot(ux, uy);
  if (m < 1e-6) return;
  const dx = (ux / m) * len, dy = -(uy / m) * len;
  const ex = x + dx, ey = y + dy;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  const ang = Math.atan2(dy, dx);
  const hs = 3.6;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - hs * Math.cos(ang - 0.5), ey - hs * Math.sin(ang - 0.5));
  ctx.lineTo(ex - hs * Math.cos(ang + 0.5), ey - hs * Math.sin(ang + 0.5));
  ctx.closePath();
  ctx.fill();
}

/* ---------------- SAR overlay: grainy noise + dark slick blobs ---------------- */
export function drawSAR(ctx: CanvasRenderingContext2D, cam: Camera, slick: Slick, tFrame: number): void {
  const d = getDomainM();
  const { sx: x0, sy: yTop } = project(cam, d.xMin, d.yMax);
  const { sx: x1 } = project(cam, d.xMax, d.yMax);
  const { sy: yBot } = project(cam, d.xMin, d.yMin);
  // grain
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, yTop, x1 - x0, yBot - yTop);
  ctx.clip();
  for (let i = 0; i < 420; i++) {
    const gx = x0 + ((i * 7919) % 997) / 997 * (x1 - x0);
    const gy = yTop + ((i * 104729) % 991) / 991 * (yBot - yTop);
    const a = 0.015 + ((i * 31) % 17) / 17 * 0.03;
    ctx.fillStyle = `rgba(160, 190, 220, ${a.toFixed(3)})`;
    ctx.fillRect(gx, gy, 2, 2);
  }
  // dark dampened blobs over the detected slick (radar damping)
  const cell = 1000;
  const stepCells = 8;
  const nx = slick.wet.length > 0 ? Math.sqrt(slick.wet.length) | 0 : 0;
  void nx;
  const gx0 = -178000, gy0 = -126000;
  for (let idx = 0; idx < slick.wetIdx.length; idx += stepCells) {
    const wIdx = slick.wetIdx[idx];
    const ci = wIdx % 356, cj = (wIdx - (wIdx % 356)) / 356;
    const wx = gx0 + (ci + 0.5) * cell, wy = gy0 + (cj + 0.5) * cell;
    const p = project(cam, wx, wy);
    const r = 7 + slick.dens[wIdx] / Math.max(1e-12, slick.maxDens) * 13;
    const g = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r);
    g.addColorStop(0, 'rgba(5, 12, 24, 0.5)');
    g.addColorStop(1, 'rgba(5, 12, 24, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // scan line sweep
  const sweep = ((tFrame * 0.06) % 1) * (x1 - x0);
  const sg = ctx.createLinearGradient(x0 + sweep - 60, 0, x0 + sweep, 0);
  sg.addColorStop(0, 'rgba(0,191,255,0)');
  sg.addColorStop(1, 'rgba(0,191,255,0.06)');
  ctx.fillStyle = sg;
  ctx.fillRect(x0 + sweep - 60, yTop, 60, yBot - yTop);
  ctx.restore();
}

/* ---------------- Spill polygon fill + contour ---------------- */
export function drawSpillPolygon(ctx: CanvasRenderingContext2D, cam: Camera, slick: Slick, mode2p5: boolean): void {
  ctx.save();
  for (let pi = 0; pi < slick.polys.length; pi++) {
    const poly = slick.polys[pi];
    ctx.beginPath();
    for (let i = 0; i < poly.length; i += 2) {
      const p = project(cam, poly[i], poly[i + 1]);
      if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 51, 102, 0.16)';
    ctx.fill();
    ctx.strokeStyle = '#ff3366';
    ctx.lineWidth = 1.6;
    if (slick.polyOpen[pi]) ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  void mode2p5;
  ctx.restore();
}

/** Second-stage boundary: dashed halo slightly outside the contour (PLAN draw order). */
export function drawSpillBoundary(ctx: CanvasRenderingContext2D, cam: Camera, slick: Slick): void {
  ctx.save();
  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = 'rgba(255, 122, 158, 0.65)';
  ctx.lineWidth = 1;
  for (let pi = 0; pi < slick.polys.length; pi++) {
    const poly = slick.polys[pi];
    ctx.beginPath();
    for (let i = 0; i < poly.length; i += 2) {
      const p = project(cam, poly[i], poly[i + 1]);
      if (i === 0) ctx.moveTo(p.sx, p.sy + 5); else ctx.lineTo(p.sx, p.sy + 5);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
  // area label at slick centroid
  const c = project(cam, slick.centroid.x, slick.centroid.y);
  const label = `Detected Oil Spill ${slick.areaKm2.toFixed(1)} km²`;
  ctx.font = '600 11px ui-monospace, monospace';
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(255, 51, 102, 0.14)';
  ctx.strokeStyle = 'rgba(255, 51, 102, 0.55)';
  roundRect(ctx, c.sx - tw / 2 - 7, c.sy - 34, tw + 14, 18, 5);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ff8fae';
  ctx.fillText(label, c.sx - tw / 2, c.sy - 21);
}

/* ---------------- Trajectories ---------------- */
export function drawTrajectories(ctx: CanvasRenderingContext2D, cam: Camera, inv: Investigation, layers: Record<LayerKey, boolean>): void {
  // backward: white (T_det → est source); forward validation: orange
  if (layers.backTraj && inv.backPath.length >= 4) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < inv.backPath.length; i += 2) {
      const p = project(cam, inv.backPath[i], inv.backPath[i + 1]);
      if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();
    // arrowheads every 6 h
    for (let i = 0; i < inv.backPath.length - 4; i += 12) {
      arrowHead(ctx, cam, inv.backPath[i], inv.backPath[i + 1], inv.backPath[i + 2], inv.backPath[i + 3], 'rgba(255,255,255,0.85)');
    }
  }
  if (layers.fwdTraj && inv.fwdPath.length >= 4) {
    ctx.strokeStyle = 'rgba(255, 170, 61, 0.9)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (let i = 0; i < inv.fwdPath.length; i += 2) {
      const p = project(cam, inv.fwdPath[i], inv.fwdPath[i + 1]);
      if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function arrowHead(ctx: CanvasRenderingContext2D, cam: Camera, x0: number, y0: number, x1: number, y1: number, color: string): void {
  const a = project(cam, x0, y0), b = project(cam, x1, y1);
  const ang = Math.atan2(b.sy - a.sy, b.sx - a.sx);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(b.sx, b.sy);
  ctx.lineTo(b.sx - 6 * Math.cos(ang - 0.45), b.sy - 6 * Math.sin(ang - 0.45));
  ctx.lineTo(b.sx - 6 * Math.cos(ang + 0.45), b.sy - 6 * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fill();
}

/* ---------------- Source rings + crosshair + uncertainty ellipse ---------------- */
export function drawSourceRings(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, nowMs: number): void {
  const c = project(cam, x, y);
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 230, 118, 0.85)';
  ctx.lineWidth = 1.4;
  const pulse = 1 + 0.12 * Math.sin(nowMs * 0.003);
  for (const r of [10, 18, 27]) {
    ctx.beginPath();
    ctx.arc(c.sx, c.sy, r * pulse, 0, Math.PI * 2);
    ctx.stroke();
  }
  // crosshair
  ctx.beginPath();
  ctx.moveTo(c.sx - 34, c.sy); ctx.lineTo(c.sx - 30, c.sy);
  ctx.moveTo(c.sx + 30, c.sy); ctx.lineTo(c.sx + 34, c.sy);
  ctx.moveTo(c.sx, c.sy - 34); ctx.lineTo(c.sx, c.sy - 30);
  ctx.moveTo(c.sx, c.sy + 30); ctx.lineTo(c.sx, c.sy + 34);
  ctx.stroke();
  ctx.fillStyle = 'rgba(0, 230, 118, 0.9)';
  ctx.beginPath(); ctx.arc(c.sx, c.sy, 2.4, 0, Math.PI * 2); ctx.fill();
  ctx.font = '600 10px ui-monospace, monospace';
  ctx.fillStyle = '#7dffc4';
  ctx.fillText('ESTIMATED SOURCE', c.sx + 38, c.sy - 24);
  ctx.restore();
}

export function drawUncertainty(ctx: CanvasRenderingContext2D, cam: Camera, inv: Investigation): void {
  const c = project(cam, inv.estX, inv.estY);
  const s = cam.w; void s;
  // ellipse in model space: rotate by θ, semi-axes a/b (metres)
  ctx.save();
  ctx.translate(c.sx, c.sy);
  ctx.rotate(-inv.covTheta); // screen y is flipped → negative rotation
  // scale model metres to screen px (y compressed by camera handled via project of unit vectors)
  const px = project(cam, inv.covA, 0), py = project(cam, 0, inv.covB);
  const rx = Math.abs(px.sx - project(cam, 0, 0).sx);
  const ry = Math.abs(py.sy - project(cam, 0, 0).sy);
  ctx.scale(1, ry / Math.max(1, rx));
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(4, rx), 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0, 191, 255, 0.75)';
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(0, 191, 255, 0.06)';
  ctx.fill();
  ctx.restore();
  // label (below the ellipse to avoid clashing with the spill-area label)
  ctx.font = '600 10px ui-monospace, monospace';
  ctx.fillStyle = '#7fd4ff';
  const lbl = `±${(inv.covA / 1000).toFixed(1)} km (2σ)`;
  ctx.fillText(lbl, c.sx + 38, c.sy + 30);
}

/* ---------------- Vessels ---------------- */
export function drawVesselTracks(ctx: CanvasRenderingContext2D, cam: Camera, fleet: Vessel[], tFrom: number, tTo: number): void {
  ctx.strokeStyle = 'rgba(143, 168, 255, 0.28)';
  ctx.lineWidth = 1;
  for (const v of fleet) {
    sampleTrack(v, tFrom, tTo, 900, TRACK);
    if (TRACK.xs.length < 2) continue;
    ctx.beginPath();
    for (let i = 0; i < TRACK.xs.length; i++) {
      const p = project(cam, TRACK.xs[i], TRACK.ys[i]);
      if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();
  }
}

export function drawVessels(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  fleet: Vessel[],
  t: number,
  suspectMmsi: number | null,
  nowMs: number
): void {
  for (const v of fleet) {
    if (!posAt(v, t, POS_BUF)) continue;
    const p = project(cam, POS_BUF[0], POS_BUF[1]);
    const hdDeg = headingOf(v, t);
    const isSuspect = suspectMmsi === v.def.mmsi;
    drawShipGlyph(ctx, p.sx, p.sy, hdDeg, v.def.color, isSuspect, nowMs);
    // label box: name / class / speed
    const kn = speedAtKn(v, t);
    const l1 = v.def.name;
    const l2 = `${v.def.cls} · ${kn.toFixed(1)} kn`;
    ctx.font = '600 10px ui-monospace, monospace';
    const w = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width) + 12;
    const bx = p.sx + 12, by = p.sy - 26;
    ctx.fillStyle = isSuspect ? 'rgba(50, 26, 8, 0.88)' : 'rgba(6, 13, 28, 0.82)';
    ctx.strokeStyle = isSuspect ? 'rgba(255, 170, 61, 0.9)' : 'rgba(90, 200, 250, 0.4)';
    ctx.lineWidth = 1;
    roundRect(ctx, bx, by, w, 30, 5);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = isSuspect ? '#ffd9a0' : '#d6e4ff';
    ctx.fillText(l1, bx + 6, by + 12);
    ctx.fillStyle = isSuspect ? '#ffb454' : '#7f92b3';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText(l2, bx + 6, by + 23);
    if (isSuspect) {
      ctx.font = '800 9px ui-monospace, monospace';
      ctx.fillStyle = '#ff5c47';
      ctx.fillText('SUSPECT', bx + 6, by - 4);
    }
  }
}

function headingOf(v: Vessel, t: number): number {
  // reuse vessels.headingAt without importing twice
  return v.ts.length > 1 ? headingImpl(v, t) : 0;
}
import { headingAt as headingImpl } from '../engine/vessels';

function drawShipGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, hdDeg: number, color: string, suspect: boolean, nowMs: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((hdDeg * Math.PI) / 180);
  if (suspect) {
    const pr = 15 + 2.5 * Math.sin(nowMs * 0.004);
    ctx.strokeStyle = 'rgba(255, 170, 61, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(0, 0, pr, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  // hull (pointing +y/north before rotation is applied via hdDeg→rotate(−hd))
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(4.4, -3);
  ctx.lineTo(4.4, 7);
  ctx.lineTo(-4.4, 7);
  ctx.lineTo(-4.4, -3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(6, 13, 28, 0.85)';
  ctx.fillRect(-2.6, -1.5, 5.2, 5.5);
  ctx.restore();
}
// NOTE: glyph rotation uses hdDeg where 0 = north (up). rotate(hd) rotates clockwise
// on screen which matches compass heading because screen y is inverted.

/* ---------------- Particles ---------------- */
export function drawParticles(ctx: CanvasRenderingContext2D, cam: Camera, eng: OceanEngine, slick: Slick | null, showConc: boolean): void {
  const n = eng.cloud.n;
  if (showConc && slick) {
    // concentration view: paint density cells as a heat gradient
    const cell = 1000, gx0 = -178000, gy0 = -126000;
    for (let idx = 0; idx < slick.wetIdx.length; idx++) {
      const wIdx = slick.wetIdx[idx];
      const ci = wIdx % 356, cj = (wIdx - (wIdx % 356)) / 356;
      const f = slick.dens[wIdx] / Math.max(1e-12, slick.maxDens);
      const p = project(cam, gx0 + (ci + 0.5) * cell, gy0 + (cj + 0.5) * cell);
      ctx.fillStyle = concColor(f);
      ctx.fillRect(p.sx - 3, p.sy - 3, 6, 6);
    }
    return;
  }
  // plain particles: 2px rects, red-orange, alpha by local density
  ctx.fillStyle = 'rgba(255, 122, 41, 0.55)';
  const px2 = 2;
  for (let i = 0; i < n; i += 2) { // stride 2 for perf (1500 sprites)
    const p = project(cam, eng.cloud.x[i], eng.cloud.y[i]);
    ctx.fillRect(p.sx, p.sy, px2, px2);
  }
}

function concColor(f: number): string {
  // green → yellow → orange → red gradient
  const stops: [number, number[]][] = [
    [0.0, [0, 230, 118]], [0.35, [255, 225, 77]], [0.7, [255, 122, 41]], [1.0, [255, 50, 50]]
  ];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (f >= stops[i][0] && f <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
  }
  const u = (f - a[0]) / Math.max(1e-6, b[0] - a[0]);
  const r = Math.round(a[1][0] + (b[1][0] - a[1][0]) * u);
  const g = Math.round(a[1][1] + (b[1][1] - a[1][1]) * u);
  const bl = Math.round(a[1][2] + (b[1][2] - a[1][2]) * u);
  return `rgba(${r},${g},${bl},${(0.18 + f * 0.5).toFixed(2)})`;
}

/* ---------------- Suspect link (yellow dashed, animated) ---------------- */
export function drawSuspectLink(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, vx: number, vy: number, nowMs: number): void {
  const a = project(cam, x, y);
  const b = project(cam, vx, vy);
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.lineDashOffset = -(nowMs * 0.02) % 28;
  ctx.strokeStyle = 'rgba(255, 225, 77, 0.95)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(a.sx, a.sy);
  ctx.lineTo(b.sx, b.sy);
  ctx.stroke();
  ctx.setLineDash([]);
  // link glow dots
  ctx.fillStyle = 'rgba(255, 225, 77, 0.9)';
  ctx.beginPath(); ctx.arc(b.sx, b.sy, 3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/* ---------------- Weather (synthetic forecast) layer ---------------- */
// v2.1: cells are advected by the SAME deterministic wind field the drift model
// uses (physics-consistent), intensity modulated by the noise field. The layers
// panel labels this honestly as "Weather (Synthetic)".
export function drawWeather(ctx: CanvasRenderingContext2D, cam: Camera, eng: OceanEngine, t: number): void {
  const out = new Float64Array(2);
  const D = getDomainM();
  const SPAN_X = D.xMax - D.xMin;
  const SPAN_Y = D.yMax - D.yMin;
  const wrap = (v: number, min: number, span: number): number =>
    min + ((((v - min) % span) + span) % span);
  for (let c = 0; c < 3; c++) {
    let x = D.xMin + (0.22 + 0.28 * c) * SPAN_X;
    let y = D.yMin + (0.24 + 0.26 * ((c * 7) % 3)) * SPAN_Y;
    sampleWind(eng.noise, x, y, t, out);
    x = wrap(x + out[0] * 0.12 * t, D.xMin, SPAN_X);
    y = wrap(y + out[1] * 0.12 * t, D.yMin, SPAN_Y);
    const n = eng.noise.vnoise(x / 45000, y / 45000, t / 21600); // [-1,1)
    const inten = 0.45 + 0.35 * n;
    const r = 34000 + 16000 * (0.5 + 0.5 * Math.sin(t * 0.00002 + c * 2.399));
    const p = project(cam, x, y);
    const g = ctx.createRadialGradient(p.sx, p.sy, r * 0.15, p.sx, p.sy, r);
    g.addColorStop(0, `rgba(179, 157, 219, ${(0.05 + 0.11 * inten).toFixed(3)})`);
    g.addColorStop(0.65, `rgba(157, 140, 200, ${(0.03 + 0.05 * inten).toFixed(3)})`);
    g.addColorStop(1, 'rgba(179, 157, 219, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(179, 157, 219, ${(0.12 + 0.13 * inten).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, r * 0.62, t * 0.0004 + c, t * 0.0004 + c + Math.PI * 1.4); ctx.stroke();
  }
}

/* ---------------- shared ---------------- */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** API truth: slick polygon, AIS tracks, leeway paths. Particles stay separate. */
/** Case wind/current from FastAPI env — drawn ON TOP of SAR, not under it. */
function drawCaseEnvFields(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  layers: Record<LayerKey, boolean>
): void {
  const env = caseData?.environment;
  if (!env) return;
  const ext = geoExtent();
  const toward = (deg: number, speed: number): { e: number; n: number } => {
    const r = (deg * Math.PI) / 180;
    return { e: speed * Math.sin(r), n: speed * Math.cos(r) };
  };
  const cur = toward(Number(env.current?.toward_deg) || 0, Number(env.current?.speed_ms) || 0);
  const wnd = toward(Number(env.wind?.toward_deg) || 0, Number(env.wind?.speed_ms) || 0);
  const lee = {
    e: cur.e + 0.03 * wnd.e,
    n: cur.n + 0.03 * wnd.n,
  };
  const stepLon = Math.max(0.035, (ext.lonMax - ext.lonMin) / 9);
  const stepLat = Math.max(0.03, (ext.latMax - ext.latMin) / 8);
  ctx.save();
  ctx.lineWidth = 1.8;
  for (let lat = ext.latMin + stepLat * 0.3; lat <= ext.latMax - stepLat * 0.1; lat += stepLat) {
    for (let lon = ext.lonMin + stepLon * 0.3; lon <= ext.lonMax - stepLon * 0.1; lon += stepLon) {
      const { x, y } = llToXY(lon, lat);
      const p = project(cam, x, y);
      if (layers.currents && Math.hypot(cur.e, cur.n) > 1e-6) {
        drawArrow(ctx, p.sx, p.sy, cur.e, cur.n, 18, 'rgba(40, 230, 255, 0.92)');
      }
      if (layers.wind && Math.hypot(wnd.e, wnd.n) > 1e-6) {
        drawArrow(ctx, p.sx + 8, p.sy - 8, wnd.e, wnd.n, 16, 'rgba(255, 255, 255, 0.92)');
      }
      if (Math.hypot(lee.e, lee.n) > 1e-6) {
        drawArrow(ctx, p.sx - 6, p.sy + 6, lee.e, lee.n, 22, 'rgba(255, 80, 120, 0.95)');
      }
    }
  }
  ctx.font = '600 11px ui-sans-serif, sans-serif';
  if (layers.currents) {
    ctx.fillStyle = 'rgba(40, 230, 255, 0.95)';
    ctx.fillText(
      `CURRENT  ${Number(env.current?.speed_ms ?? 0).toFixed(2)} m/s toward ${Number(env.current?.toward_deg ?? 0).toFixed(0)}° (0°=N)`,
      12, cam.h - 28
    );
  }
  if (layers.wind) {
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(
      `WIND  ${Number(env.wind?.speed_ms ?? 0).toFixed(1)} m/s toward ${Number(env.wind?.toward_deg ?? 0).toFixed(0)}° (0°=N) · pink = leeway`,
      12, cam.h - 12
    );
  }
  ctx.restore();
}

/** Range rings in metres around the moving slick (scale with cursor zoom). */
function drawSlickRings(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  poly: { x: number; y: number }[]
): void {
  if (poly.length < 3) return;
  let sx = 0, sy = 0;
  for (const p of poly) { sx += p.x; sy += p.y; }
  const cx = sx / poly.length, cy = sy / poly.length;
  const c = project(cam, cx, cy);
  const radiiM = [2500, 5000, 10000, 20000];
  ctx.save();
  for (const r of radiiM) {
    const e = project(cam, cx + r, cy);
    const n = project(cam, cx, cy + r);
    const rx = Math.abs(e.sx - c.sx);
    const ry = Math.abs(n.sy - c.sy);
    if (rx < 4 && ry < 4) continue;
    ctx.beginPath();
    ctx.ellipse(c.sx, c.sy, Math.max(2, rx), Math.max(2, ry), 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 80, 120, 0.55)';
    ctx.lineWidth = r === 5000 ? 1.4 : 1;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255, 180, 196, 0.9)';
    ctx.font = '600 10px ui-sans-serif, sans-serif';
    ctx.fillText(`${r / 1000} km`, c.sx + rx + 4, c.sy - (r === 5000 ? 2 : 0));
  }
  ctx.restore();
}

export function drawCaseTruth(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  layers: Record<LayerKey, boolean>,
  nowMs = 0
): void {
  const p = getProjector();
  if (!p || !caseData) return;
  const { sx: x0, sy: yTop } = project(cam, p.xMin, p.yMax);
  const { sx: x1 } = project(cam, p.xMax, p.yMax);
  const { sy: yBot } = project(cam, p.xMin, p.yMin);

  ctx.save();
  if (layers.sarOverlay) {
    const im = sarImage();
    if (im) {
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(im, x0, yTop, x1 - x0, yBot - yTop);
      ctx.restore();
    }
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(0, 191, 255, 0.7)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x0, yTop, x1 - x0, yBot - yTop);
    ctx.setLineDash([]);
    ctx.font = '600 10px ui-sans-serif, sans-serif';
    ctx.fillStyle = '#9fd8ff';
    ctx.fillText('SAR frame', x0 + 6, yTop + 14);
  }

  if (layers.currents || layers.wind) drawCaseEnvFields(ctx, cam, layers);

  if (!oilExistsAt(state.tHours) && (layers.oilSpill || layers.spillBoundary)) {
    ctx.font = '600 12px ui-sans-serif, sans-serif';
    ctx.fillStyle = '#ffd27a';
    ctx.fillText(`Approach — oil not discharged yet (discharge ${dischargeHours().toFixed(0)} h vs SAR)`, 14, 36);
  }

  const poly = polyXY(state.tHours);
  if (poly.length >= 3 && (layers.oilSpill || layers.spillBoundary)) {
    ctx.beginPath();
    const a = project(cam, poly[0].x, poly[0].y);
    ctx.moveTo(a.sx, a.sy);
    for (let i = 1; i < poly.length; i++) {
      const q = project(cam, poly[i].x, poly[i].y);
      ctx.lineTo(q.sx, q.sy);
    }
    ctx.closePath();
    if (layers.oilSpill) {
      ctx.fillStyle = 'rgba(255, 51, 102, 0.28)';
      ctx.fill();
    }
    if (layers.spillBoundary) {
      ctx.strokeStyle = '#ff3366';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    drawSlickRings(ctx, cam, poly);
  }

  if (layers.oilSpill && poly.length >= 3) {
    const cc = caseCentroid();
    const area = caseData.slick?.area_km2;
    if (cc && area != null && Number.isFinite(area)) {
      const moved = polyXY(state.tHours);
      const mid = moved[Math.floor(moved.length / 2)] ?? { x: p.lonToX(cc.lon), y: p.latToY(cc.lat) };
      const c = project(cam, mid.x, mid.y);
      const label = `OIL SLICK  ${area.toFixed(1)} km²  (leeway)`;
      ctx.font = '600 12px ui-sans-serif, sans-serif';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(20, 8, 16, 0.78)';
      ctx.strokeStyle = 'rgba(255, 51, 102, 0.7)';
      roundRect(ctx, c.sx - tw / 2 - 8, c.sy - 16, tw + 16, 22, 5);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffd0dc';
      ctx.fillText(label, c.sx - tw / 2, c.sy);
    }
  }

  const strokePath = (pts: { x: number; y: number }[], color: string, dash?: number[]) => {
    if (pts.length < 2) return;
    ctx.beginPath();
    const a = project(cam, pts[0].x, pts[0].y);
    ctx.moveTo(a.sx, a.sy);
    for (let i = 1; i < pts.length; i++) {
      const q = project(cam, pts[i].x, pts[i].y);
      ctx.lineTo(q.sx, q.sy);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dash ?? []);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  if (layers.backTraj) strokePath(pathXY('hindcast'), 'rgba(220,220,220,0.85)');
  if (layers.fwdTraj) {
    const fwd = pathXY('forecast');
    strokePath(fwd, 'rgba(255,200,60,0.95)', [8, 5]);
    if (fwd.length >= 2) {
      const last = project(cam, fwd[fwd.length - 1].x, fwd[fwd.length - 1].y);
      ctx.font = '600 11px ui-sans-serif, sans-serif';
      ctx.fillStyle = '#ffd27a';
      ctx.fillText('FORECAST (yellow dash)', last.sx + 8, last.sy - 6);
    }
  }

  const o = caseOrigin();
  if (layers.estSource && o) {
    drawSourceRings(ctx, cam, p.lonToX(o.lon), p.latToY(o.lat), nowMs);
  }

  const ranked = rankedVessels();
  const top = ranked[0];
  for (const v of ranked) {
    if (layers.vesselTracks) strokePath(trackXY(v), 'rgba(143,168,255,0.55)', [4, 4]);
    if (layers.vessels) {
      const pos = vesselAtHours(v, state.tHours);
      if (!pos) continue;
      const q = project(cam, pos.x, pos.y);
      const isTop = !!(top && v.mmsi === top.mmsi);
      if (isTop) {
        const pulse = 1 + 0.12 * Math.sin(nowMs * 0.006);
        ctx.strokeStyle = 'rgba(255, 80, 60, 0.9)';
        ctx.lineWidth = 1.6;
        for (const r of [12, 20, 28]) {
          ctx.beginPath();
          ctx.arc(q.sx, q.sy, r * pulse, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.fillStyle = isTop ? '#ff4a32' : '#5ac8fa';
      ctx.beginPath();
      ctx.arc(q.sx, q.sy, isTop ? 8 : 4, 0, Math.PI * 2);
      ctx.fill();
      if (isTop) {
        const raw = Number(v.score);
        const pct = Number.isFinite(raw) ? Math.round((raw > 1 ? raw / 100 : raw) * 100) : 0;
        const cpa = typeof v.cpa_to_origin_km === 'number' ? v.cpa_to_origin_km.toFixed(2) : '—';
        const label = `${v.name || '?'}  #1 · ${pct}%`;
        ctx.font = '700 12px ui-sans-serif, sans-serif';
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(40, 8, 8, 0.88)';
        ctx.strokeStyle = 'rgba(255, 80, 60, 0.9)';
        roundRect(ctx, q.sx + 12, q.sy - 28, tw + 16, 36, 6);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffd0c8';
        ctx.fillText(label, q.sx + 20, q.sy - 12);
        ctx.font = '600 10px ui-sans-serif, sans-serif';
        ctx.fillStyle = '#ffb3a8';
        ctx.fillText(`PRIMARY SUSPECT · CPA ${cpa} km`, q.sx + 20, q.sy + 2);
      } else {
        ctx.fillStyle = 'rgba(230,240,255,0.9)';
        ctx.font = '10px ui-sans-serif, sans-serif';
        ctx.fillText(v.name || v.mmsi || '?', q.sx + 7, q.sy - 4);
      }
    }
  }
  if (layers.vessels && top && o) {
    const pos = vesselAtHours(top, state.tHours);
    if (pos) drawSuspectLink(ctx, cam, p.lonToX(o.lon), p.latToY(o.lat), pos.x, pos.y, nowMs);
  }
  ctx.restore();
}

export { T_DET_S, T_SRC_EPOCH_MS };
