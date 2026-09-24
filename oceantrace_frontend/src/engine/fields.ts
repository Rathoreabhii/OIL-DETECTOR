/**
 * OCEANTRACE — Deterministic wind + current fields (PLAN §4 "Fields").
 *
 * Conventions
 * -----------
 * Coordinates: x = metres EAST, y = metres NORTH, origin at (72.0°E, 12.5°N).
 * Time t = seconds since release T_src_true (t=0). T_det = +129600 s.
 *
 * Wind (PLAN): u_wind = W0 · dir(θw(t)) · (1 + 0.3·vnoise(x/50km, y/50km, t/6h))
 *   W0 = 8 m/s; θw drifts sinusoidally ±25° over 24 h around 285°.
 *   θw is METEOROLOGICAL "wind from" bearing; the drift vector points toward θw+180°.
 *
 * Currents (PLAN): divergence-free curl noise from a stream function
 *   ψ = A · vnoise(x/30km, y/30km, t/12h);  u = ∂ψ/∂y,  v = −∂ψ/∂x.
 *   A = PSI_AMP is tuned so |u_cur| ∈ 0.1–0.5 m/s (verified in src/test/physics.ts).
 *
 * Windage = 0.03·u_wind ; Stokes drift = 0.02·u_wind (PLAN §4).
 * Kh_eff = 5 + 0.002·t m²/s (Fay-informed growth, PLAN §4).
 *
 * All noise is seeded 3-D value noise with quintic fade (C2-smooth enough for
 * finite/analytic gradients). Fully deterministic for a fixed seed.
 */

export const KM_LAT = 111.32;                              // km per degree latitude
export const KM_LON = 111.32 * Math.cos((12 * Math.PI) / 180); // ≈108.887 km per degree lon at 12°N

export const W0 = 8.0;             // m/s mean wind speed
export const WIND_BASE_DEG = 285;  // base wind bearing (FROM)
export const WIND_DRIFT_DEG = 25;  // ± amplitude over 24 h
export const WIND_SCALE = 50000;   // m, spatial scale of wind noise
export const WIND_TSCALE = 6 * 3600; // s, temporal scale of wind noise
export const CUR_SCALE = 30000;    // m, spatial scale of current noise
export const CUR_TSCALE = 12 * 3600; // s, temporal scale of current noise
export const PSI_AMP = 4000;       // m²/s stream-function amplitude (calibrated)
export const WINDAGE = 0.03;       // windage factor (PLAN)
export const STOKES = 0.02;        // Stokes drift factor (PLAN)
export const KH0 = 5;              // m²/s base horizontal diffusivity
export const KH_GROWTH = 0.002;    // m²/s per second (Fay-informed growth)

export function lonToX(lon: number): number { return (lon - 72) * KM_LON * 1000; }
export function latToY(lat: number): number { return (lat - 12.5) * KM_LAT * 1000; }
export function xToLon(x: number): number { return 72 + x / (KM_LON * 1000); }
export function yToLat(y: number): number { return 12.5 + y / (KM_LAT * 1000); }
export function kmToLatOffset(km: number): number { return km / KM_LAT; }
export function kmToLonOffset(km: number): number { return km / KM_LON; }

export interface NoiseField {
  /** value noise in [-1,1) */
  vnoise(x: number, y: number, z: number): number;
  /** value + analytic ∂/∂x, ∂/∂y (per noise-space unit) written into out[0..2] */
  vnoiseD(x: number, y: number, z: number, out: Float64Array): void;
}

/** Integer hash → [-1,1). avalanche-mixed; deterministic for a fixed seed. */
function lattice(seed: number): (i: number, j: number, k: number) => number {
  const s = seed | 0;
  return (i: number, j: number, k: number): number => {
    let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x9e3779b9) ^ s;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return ((h >>> 0) / 4294967296) * 2 - 1;
  };
}

export function makeNoise(seed: number): NoiseField {
  const h = lattice(seed);
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

  function vnoise(x: number, y: number, z: number): number {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const ux = fade(fx), uy = fade(fy), uz = fade(fz);
    const c000 = h(ix, iy, iz), c100 = h(ix + 1, iy, iz);
    const c010 = h(ix, iy + 1, iz), c110 = h(ix + 1, iy + 1, iz);
    const c001 = h(ix, iy, iz + 1), c101 = h(ix + 1, iy, iz + 1);
    const c011 = h(ix, iy + 1, iz + 1), c111 = h(ix + 1, iy + 1, iz + 1);
    const x00 = c000 + (c100 - c000) * ux;
    const x10 = c010 + (c110 - c010) * ux;
    const x01 = c001 + (c101 - c001) * ux;
    const x11 = c011 + (c111 - c011) * ux;
    const y0 = x00 + (x10 - x00) * uy;
    const y1 = x01 + (x11 - x01) * uy;
    return y0 + (y1 - y0) * uz;
  }

  function vnoiseD(x: number, y: number, z: number, out: Float64Array): void {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const ux = fade(fx), uy = fade(fy), uz = fade(fz);
    // fade'(t) = 30 t² (1-t)²
    const dux = 30 * fx * fx * (fx - 1) * (fx - 1);
    const duy = 30 * fy * fy * (fy - 1) * (fy - 1);
    const c000 = h(ix, iy, iz), c100 = h(ix + 1, iy, iz);
    const c010 = h(ix, iy + 1, iz), c110 = h(ix + 1, iy + 1, iz);
    const c001 = h(ix, iy, iz + 1), c101 = h(ix + 1, iy, iz + 1);
    const c011 = h(ix, iy + 1, iz + 1), c111 = h(ix + 1, iy + 1, iz + 1);
    const x00 = c000 + (c100 - c000) * ux;
    const x10 = c010 + (c110 - c010) * ux;
    const x01 = c001 + (c101 - c001) * ux;
    const x11 = c011 + (c111 - c011) * ux;
    const y0 = x00 + (x10 - x00) * uy;
    const y1 = x01 + (x11 - x01) * uy;
    out[0] = y0 + (y1 - y0) * uz;
    const d00 = c100 - c000, d10 = c110 - c010, d01 = c101 - c001, d11 = c111 - c011;
    out[1] = dux * ((1 - uy) * ((1 - uz) * d00 + uz * d01) + uy * ((1 - uz) * d10 + uz * d11));
    out[2] = duy * ((1 - uz) * (x10 - x00) + uz * (x11 - x01));
  }

  return { vnoise, vnoiseD };
}

// Scratch buffers (module-level, single-threaded hot loop)
const _nd = new Float64Array(3);

/** Wind velocity (m/s) at (x,y,t): out = [u_east, v_north]. */
export function sampleWind(noise: NoiseField, x: number, y: number, t: number, out: Float64Array): void {
  // θw drifts ±25° over 24 h around 285° (met. "from" bearing)
  const fromDeg = WIND_BASE_DEG + WIND_DRIFT_DEG * Math.sin((2 * Math.PI * (t / 3600)) / 24);
  const toward = ((fromDeg + 180) * Math.PI) / 180; // direction wind blows TOWARD
  const ex = Math.sin(toward), ny = Math.cos(toward);
  const mod = 1 + 0.3 * noise.vnoise(x / WIND_SCALE, y / WIND_SCALE, t / WIND_TSCALE);
  const sp = W0 * mod;
  out[0] = sp * ex;
  out[1] = sp * ny;
}

/**
 * Current velocity (m/s) at (x,y,t): out = [u_east, v_north].
 * ψ = A·vnoise → u = ∂ψ/∂y, v = −∂ψ/∂x (divergence-free curl noise, PLAN §4).
 */
export function sampleCurrent(noise: NoiseField, x: number, y: number, t: number, out: Float64Array): void {
  noise.vnoiseD(x / CUR_SCALE, y / CUR_SCALE, t / CUR_TSCALE, _nd);
  // chain rule: dψ/dx = A · (∂v/∂u₁) / CUR_SCALE
  out[0] = (PSI_AMP * _nd[2]) / CUR_SCALE;   // u = ∂ψ/∂y
  out[1] = (-PSI_AMP * _nd[1]) / CUR_SCALE;  // v = −∂ψ/∂x
}

/** Effective horizontal diffusivity at model time t (s since release). PLAN: 5 + 0.002·t. */
export function khEff(t: number): number {
  return KH0 + KH_GROWTH * t;
}
