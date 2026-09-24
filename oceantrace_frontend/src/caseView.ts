import { CaseJson, CaseVessel, centroidOf, originOf } from './api';
import { CaseProjector, getProjector, setProjector } from './geo';
import { leewayEN, shiftPolygon, stepLatLon } from './leeway';

export let caseData: CaseJson | null = null;
export let caseError: string | null = null;
let sarImg: HTMLImageElement | null = null;

function asBounds(raw: unknown): [[number, number], [number, number]] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const a = raw[0], b = raw[1];
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return null;
  const south = Math.min(Number(a[0]), Number(b[0]));
  const north = Math.max(Number(a[0]), Number(b[0]));
  const west = Math.min(Number(a[1]), Number(b[1]));
  const east = Math.max(Number(a[1]), Number(b[1]));
  if (![south, north, west, east].every(Number.isFinite)) return null;
  if (north - south < 1e-5 || east - west < 1e-5) return null;
  return [[south, west], [north, east]];
}

export function applyCase(data: CaseJson): void {
  caseData = data;
  caseError = null;
  let b = asBounds(data.sar?.bounds);
  if (!b) {
    const c = centroidOf(data.slick);
    if (c) b = [[c.lat - 0.18, c.lon - 0.28], [c.lat + 0.18, c.lon + 0.28]];
  }
  if (!b) throw new Error('case_001 has no SAR bounds — cannot place the map');
  setProjector(new CaseProjector(b));
  const url = data.sar?.image_url;
  if (url) {
    const im = new Image();
    im.onload = () => { sarImg = im; };
    im.src = url;
  }
}

export function setCaseError(msg: string): void {
  caseError = msg;
  caseData = null;
}

export function sarImage(): HTMLImageElement | null {
  return sarImg && sarImg.complete ? sarImg : null;
}

export function caseCentroid(): { lat: number; lon: number } | null {
  return centroidOf(caseData?.slick);
}

export function caseOrigin(): { lat: number; lon: number } | null {
  const c = caseCentroid();
  if (!c) return null;
  return originOf(caseData?.drift, c);
}

export function rankedVessels(): CaseVessel[] {
  const vs = caseData?.vessels ?? [];
  return vs.slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
}

export function obsMs(): number {
  const t = caseData?.observed_at ? Date.parse(caseData.observed_at) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

/** Hours from SAR observation for a track/drift point. */
export function pointHours(pt: { t?: string; t_hours?: number }): number | null {
  if (typeof pt.t_hours === 'number' && Number.isFinite(pt.t_hours)) return pt.t_hours;
  const obs = obsMs();
  if (pt.t && Number.isFinite(obs)) {
    const ms = Date.parse(pt.t);
    if (Number.isFinite(ms)) return (ms - obs) / 3600000;
  }
  return null;
}

/** Hindcast origin / reconstructed discharge, hours relative to SAR (negative). */
export function dischargeHours(): number {
  const hind = caseData?.drift?.hindcast;
  if (hind?.length) {
    let best = 0;
    for (const pt of hind) {
      const h = pointHours(pt);
      if (h != null && h < best) best = h;
    }
    if (best < 0) return best;
  }
  const age = Number(caseData?.slick?.age_hours_est);
  return Number.isFinite(age) && age > 0 ? -Math.abs(age) : -16;
}

export const PRE_DISCHARGE_H = 4;

export function hoursRange(): { min: number; max: number } {
  const dis = dischargeHours();
  const last = caseData?.drift?.forecast?.at(-1)?.t_hours;
  const max = Number.isFinite(Number(last)) ? Number(last) : 16;
  return { min: dis - PRE_DISCHARGE_H, max };
}

export function oilExistsAt(tHours: number): boolean {
  return tHours >= dischargeHours() - 1e-6;
}

function originBlob(origin: { lat: number; lon: number }, radiusM = 450, n = 24): [number, number][] {
  const dlat = radiusM / 1000 / 111.32;
  const dlon = radiusM / 1000 / Math.max(1e-6, 111.32 * Math.cos((origin.lat * Math.PI) / 180));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([origin.lat + dlat * Math.cos(a), origin.lon + dlon * Math.sin(a)]);
  }
  return out;
}

export function polyXY(tHours = 0): { x: number; y: number }[] {
  if (!oilExistsAt(tHours)) return [];
  const p = getProjector();
  const poly = caseData?.slick?.polygon;
  const origin = caseOrigin();
  if (!p || !poly?.length || !origin) return [];
  const t0 = dischargeHours();
  if (tHours >= -1e-6) {
    const moved = shiftPolygon(poly, caseData?.environment, tHours);
    return moved.map(([lat, lon]) => ({ x: p.lonToX(lon), y: p.latToY(lat) }));
  }
  const span = Math.max(1e-6, -t0);
  const u = Math.min(1, Math.max(0, (tHours - t0) / span));
  if (u <= 0.04) {
    return originBlob(origin).map(([lat, lon]) => ({ x: p.lonToX(lon), y: p.latToY(lat) }));
  }
  const { east, north } = leewayEN(caseData?.environment ?? {});
  const drifted = stepLatLon(origin.lat, origin.lon, east, north, tHours - t0);
  const sar = centroidOf(caseData?.slick);
  const grow = poly.map(([lat, lon]) => {
    const glat = origin.lat + (lat - origin.lat) * u;
    const glon = origin.lon + (lon - origin.lon) * u;
    return [glat, glon] as [number, number];
  });
  if (sar) {
    const growC = {
      lat: grow.reduce((s, q) => s + q[0], 0) / grow.length,
      lon: grow.reduce((s, q) => s + q[1], 0) / grow.length,
    };
    const dLat = drifted.lat - growC.lat;
    const dLon = drifted.lon - growC.lon;
    return grow.map(([lat, lon]) => ({
      x: p.lonToX(lon + dLon),
      y: p.latToY(lat + dLat),
    }));
  }
  return grow.map(([lat, lon]) => ({ x: p.lonToX(lon), y: p.latToY(lat) }));
}

export function pathXY(
  which: 'hindcast' | 'forecast'
): { x: number; y: number }[] {
  const p = getProjector();
  const raw = caseData?.drift?.[which];
  if (!p || !raw) return [];
  return raw.map((pt) => ({ x: p.lonToX(pt.lon), y: p.latToY(pt.lat) }));
}

export function trackXY(v: CaseVessel): { x: number; y: number }[] {
  const p = getProjector();
  if (!p || !v.track) return [];
  return v.track.map((t) => ({ x: p.lonToX(t.lon), y: p.latToY(t.lat) }));
}

function trackHours(v: CaseVessel): { h: number; lat: number; lon: number }[] {
  const out: { h: number; lat: number; lon: number }[] = [];
  for (const pt of v.track ?? []) {
    const h = pointHours(pt);
    if (h == null || !Number.isFinite(pt.lat) || !Number.isFinite(pt.lon)) continue;
    out.push({ h, lat: pt.lat, lon: pt.lon });
  }
  out.sort((a, b) => a.h - b.h);
  return out;
}

function inAisGap(v: CaseVessel, tHours: number): boolean {
  const gap = v.ais_gap;
  const obs = obsMs();
  if (!gap || !Number.isFinite(obs)) return false;
  const a = gap.start ? Date.parse(gap.start) : NaN;
  const b = gap.end ? Date.parse(gap.end) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const t = obs + tHours * 3600000;
  return t >= Math.min(a, b) && t <= Math.max(a, b);
}

export function vesselAtHours(v: CaseVessel, tHours: number): { x: number; y: number } | null {
  const p = getProjector();
  const pts = trackHours(v);
  if (!p || !pts.length) return null;
  if (inAisGap(v, tHours)) {
    const before = [...pts].reverse().find((pt) => pt.h <= tHours) ?? pts[0];
    return { x: p.lonToX(before.lon), y: p.latToY(before.lat) };
  }
  if (tHours <= pts[0].h) return { x: p.lonToX(pts[0].lon), y: p.latToY(pts[0].lat) };
  const last = pts[pts.length - 1];
  if (tHours >= last.h) return { x: p.lonToX(last.lon), y: p.latToY(last.lat) };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (tHours < a.h || tHours > b.h) continue;
    const u = (tHours - a.h) / Math.max(1e-6, b.h - a.h);
    return {
      x: p.lonToX(a.lon + (b.lon - a.lon) * u),
      y: p.latToY(a.lat + (b.lat - a.lat) * u),
    };
  }
  return { x: p.lonToX(last.lon), y: p.latToY(last.lat) };
}

export function vesselAtObs(v: CaseVessel): { x: number; y: number } | null {
  const p = getProjector();
  if (!p || !v.track?.length) return null;
  const obsMs = caseData?.observed_at ? Date.parse(caseData.observed_at) : NaN;
  let best = v.track[0];
  let bestAbs = Infinity;
  for (const pt of v.track) {
    let dt = Infinity;
    if (typeof pt.t_hours === 'number') dt = Math.abs(pt.t_hours);
    else if (pt.t && Number.isFinite(obsMs)) dt = Math.abs(Date.parse(pt.t) - obsMs);
    if (dt < bestAbs) { best = pt; bestAbs = dt; }
  }
  return { x: p.lonToX(best.lon), y: p.latToY(best.lat) };
}
