/**
 * OCEANTRACE — Slick geometry: KDE → density grid → contour polygon → area (PLAN §4).
 *
 * KDE: Gaussian kernel σ=2 km on a 1 km grid over active particles (weight=1),
 * kernel truncated at 3σ. Grid is fixed over the domain (+margin) so that the
 * observed slick and the forward-validation slick share the same lattice —
 * required for the fwdMatch intersection/union metric.
 *
 * Polygon: threshold = 15th percentile of wet-cell densities; boundary extracted
 * with marching squares + segment chaining. Fallback (PLAN §10): if chaining
 * fails, raw segments are returned as open polylines (draw dashed, no fill).
 *
 * Area = Σ wet cells × 1 km².
 */
import { ParticleCloud } from './particles';
import { KM_LAT, KM_LON } from './fields';

/** Fixed KDE lattice: 1 km cells covering the domain plus ~15 km margin. */
export const GRID = {
  x0: -178000,
  y0: -126000,
  nx: 356,   // covers x ∈ [-178, 178] km
  ny: 252,   // covers y ∈ [-126, 126] km
  cell: 1000 // m
};

export const SIGMA_KDE = 2000; // m — PLAN §4

export interface Slick {
  t: number;
  dens: Float32Array;      // nx*ny
  maxDens: number;
  wet: Uint8Array;         // 1 where dens > 0
  wetIdx: Int32Array;      // indices of wet cells
  wetCount: number;
  areaKm2: number;         // Σ wet cells × 1 km²
  coreAreaKm2: number;     // cells ≥ 50 % of peak density (core slick, honest metric)
  iso: number;             // 15th-percentile threshold of wet cells
  polys: Float64Array[];   // closed loops, flat [x0,y0,x1,y1,…] in metres
  polyOpen: boolean[];     // true if loop was closed by fallback (open chain)
  centroid: { x: number; y: number }; // wet-cell centroid (for label anchor)
  bbox: { minX: number; minY: number; maxX: number; maxY: number }; // wet extent
}

/** Gaussian KDE on the fixed 1 km lattice; σ=2 km, truncation 3σ. */
export function computeKDE(cloud: ParticleCloud, t: number): Slick {
  const { nx, ny, cell, x0, y0 } = GRID;
  const dens = new Float32Array(nx * ny);
  const TWO_PI_SIG2 = 2 * Math.PI * SIGMA_KDE * SIGMA_KDE;
  const cut = 3 * SIGMA_KDE;
  const rc = Math.ceil(cut / cell); // kernel radius in cells (6)

  const wCount = new Float64Array(2); // centroid accumulators
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (let p = 0; p < cloud.n; p++) {
    const px = cloud.x[p], py = cloud.y[p];
    const gx = Math.floor((px - x0) / cell);
    const gy = Math.floor((py - y0) / cell);
    if (gx < -rc || gy < -rc || gx >= nx + rc || gy >= ny + rc) continue; // far outside
    // sub-cell offset of particle from its own cell centre
    const cxm = x0 + (gx + 0.5) * cell;
    const cym = y0 + (gy + 0.5) * cell;
    const ox = px - cxm, oy = py - cym;
    const jLo = Math.max(0, gy - rc), jHi = Math.min(ny - 1, gy + rc);
    const iLo = Math.max(0, gx - rc), iHi = Math.min(nx - 1, gx + rc);
    for (let j = jLo; j <= jHi; j++) {
      const dy = (j - gy) * cell - oy;
      const dy2 = dy * dy;
      for (let i = iLo; i <= iHi; i++) {
        const dx = (i - gx) * cell - ox;
        const r2 = dx * dx + dy2;
        if (r2 > cut * cut) continue;
        dens[j * nx + i] += Math.exp(-r2 / TWO_PI_SIG2) / TWO_PI_SIG2;
      }
    }
    // wet-extent tracking (3σ influence)
    const ex0 = px - cut, ex1 = px + cut, ey0 = py - cut, ey1 = py + cut;
    if (ex0 < minX) minX = ex0; if (ex1 > maxX) maxX = ex1;
    if (ey0 < minY) minY = ey0; if (ey1 > maxY) maxY = ey1;
    wCount[0] += px; wCount[1] += py;
  }

  // wet cells + area + percentile threshold
  const wet = new Uint8Array(nx * ny);
  const wetVals: number[] = [];
  const wetList: number[] = [];
  let wetCount = 0, maxDens = 0;
  let sx = 0, sy = 0;
  for (let idx = 0; idx < nx * ny; idx++) {
    const d = dens[idx];
    if (d > 0) {
      wet[idx] = 1;
      wetVals.push(d);
      wetList.push(idx);
      wetCount++;
      if (d > maxDens) maxDens = d;
      const i = idx % nx, j = (idx - (idx % nx)) / nx;
      sx += x0 + (i + 0.5) * cell;
      sy += y0 + (j + 0.5) * cell;
    }
  }
  wetVals.sort((a, b) => a - b);
  const iso = wetVals.length > 0 ? wetVals[Math.floor(0.15 * (wetVals.length - 1))] : 0;

  const polys = iso > 0 ? contourPolygons(dens, nx, ny, iso) : { polys: [] as Float64Array[], open: [] as boolean[] };
  const areaKm2 = wetCount; // 1 cell = 1 km² exactly
  let coreCount = 0;
  const halfMax = maxDens * 0.5;
  for (let idx = 0; idx < wetList.length; idx++) if (dens[wetList[idx]] >= halfMax) coreCount++;
  const coreAreaKm2 = coreCount; // 1 cell = 1 km² exactly

  return {
    t,
    dens,
    maxDens,
    wet,
    wetIdx: Int32Array.from(wetList),
    wetCount,
    areaKm2,
    coreAreaKm2,
    iso,
    polys: polys.polys,
    polyOpen: polys.open,
    centroid: wetCount > 0 ? { x: sx / wetCount, y: sy / wetCount } : { x: 0, y: 0 },
    bbox: { minX, minY, maxX, maxY }
  };
}

/** IoU of wet-cell sets between two slicks on the shared lattice (fwdMatch). */
export function wetIoU(a: Slick, b: Slick): number {
  const n = Math.min(a.wet.length, b.wet.length);
  let inter = 0, uni = 0;
  for (let i = 0; i < n; i++) {
    const av = a.wet[i], bv = b.wet[i];
    if (av | bv) uni++;
    if (av & bv) inter++;
  }
  return uni > 0 ? inter / uni : 0;
}

/* --------------------------------------------------------------------------
 * Marching squares with linear interpolation + segment chaining.
 * Grid node (i,j) is the centre of cell (i,j): x = x0+(i+.5)·cell.
 * -------------------------------------------------------------------------- */

function contourPolygons(dens: Float32Array, nx: number, ny: number, iso: number): { polys: Float64Array[]; open: boolean[] } {
  const segs: number[] = []; // flat x1,y1,x2,y2 in node coordinates (i,j floats)
  const cell = GRID.cell, x0 = GRID.x0, y0 = GRID.y0;
  const v = (i: number, j: number): number => dens[j * nx + i];
  const frac = (a: number, b: number): number => {
    const d = b - a;
    if (Math.abs(d) < 1e-30) return 0.5;
    return Math.min(1, Math.max(0, (iso - a) / d));
  };

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v0 = v(i, j), v1 = v(i + 1, j), v2 = v(i + 1, j + 1), v3 = v(i, j + 1);
      let c = 0;
      if (v0 >= iso) c |= 1;
      if (v1 >= iso) c |= 2;
      if (v2 >= iso) c |= 4;
      if (v3 >= iso) c |= 8;
      if (c === 0 || c === 15) continue;
      // edge points in (i,j) space
      const eb = (): number[] => [i + frac(v0, v1), j];
      const er = (): number[] => [i + 1, j + frac(v1, v2)];
      const et = (): number[] => [i + frac(v3, v2), j + 1];
      const el = (): number[] => [i, j + frac(v0, v3)];
      const push = (a: number[], b: number[]): void => { segs.push(a[0], a[1], b[0], b[1]); };
      switch (c) {
        case 1: case 14: push(el(), eb()); break;
        case 2: case 13: push(eb(), er()); break;
        case 3: case 12: push(el(), er()); break;
        case 4: case 11: push(er(), et()); break;
        case 6: case 9: push(eb(), et()); break;
        case 7: case 8: push(el(), et()); break;
        case 5: push(el(), eb()); push(er(), et()); break; // ambiguous — split
        case 10: push(eb(), er()); push(el(), et()); break; // ambiguous — split
      }
    }
  }

  if (segs.length === 0) return { polys: [], open: [] };

  // Chain segments into loops. Quantise endpoints (shared points are computed
  // from identical corner pairs → identical floats → identical quantisation).
  const key = (x: number, y: number): string => `${Math.round(x * 16)}_${Math.round(y * 16)}`;
  const map = new Map<string, number[]>();
  const nseg = segs.length / 4;
  for (let s = 0; s < nseg; s++) {
    const k1 = key(segs[s * 4], segs[s * 4 + 1]);
    const k2 = key(segs[s * 4 + 2], segs[s * 4 + 3]);
    (map.get(k1) ?? map.set(k1, []).get(k1)!).push(s);
    if (k2 !== k1) (map.get(k2) ?? map.set(k2, []).get(k2)!).push(s);
  }

  const used = new Uint8Array(nseg);
  const polys: Float64Array[] = [];
  const open: boolean[] = [];

  for (let s0 = 0; s0 < nseg; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const pts: number[] = [segs[s0 * 4], segs[s0 * 4 + 1], segs[s0 * 4 + 2], segs[s0 * 4 + 3]];
    let headKey = key(pts[0], pts[1]);
    let tailKey = key(pts[2], pts[3]);
    // extend tail until we loop back to head (or run out of unused segments)
    let guard = 0;
    while (tailKey !== headKey && guard++ < 20000) {
      const cands = map.get(tailKey);
      let next = -1;
      if (cands) {
        for (const c of cands) {
          if (!used[c]) { next = c; break; }
        }
      }
      if (next < 0) break;
      used[next] = 1;
      const ax = segs[next * 4], ay = segs[next * 4 + 1], bx = segs[next * 4 + 2], by = segs[next * 4 + 3];
      const aKey = key(ax, ay);
      if (aKey === tailKey) { pts.push(bx, by); tailKey = key(bx, by); }
      else { pts.push(ax, ay); tailKey = key(ax, ay); }
    }
    const closed = tailKey === headKey && pts.length >= 8;
    if (pts.length < 6) continue; // speck
    const world = new Float64Array(pts.length);
    for (let p = 0; p < pts.length; p += 2) {
      world[p] = x0 + (pts[p] + 0.5) * cell;
      world[p + 1] = y0 + (pts[p + 1] + 0.5) * cell;
    }
    polys.push(world);
    open.push(!closed);
    if (polys.length > 64) break; // sanity cap
  }
  return { polys, open };
}

/** Convenience: slick centroid in geographic degrees. */
export function slickCentroidLL(s: Slick): { lat: number; lon: number } {
  return {
    lon: 72 + s.centroid.x / (KM_LON * 1000),
    lat: 12.5 + s.centroid.y / (KM_LAT * 1000)
  };
}
