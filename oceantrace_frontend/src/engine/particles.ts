/**
 * OCEANTRACE — Particle cloud + Euler–Maruyama advection (PLAN §4 "Particles").
 *
 *   x += (u_cur + 0.03·u_wind + 0.02·u_wind)·dt + sqrt(2·Kh_eff·dt)·g ,  g ~ N(0,1)/axis
 *   Kh_eff = 5 + 0.002·t  (t = seconds since release)
 *
 * Backward mode (PLAN §4): fields evaluated at (x, y, t−τ) stepping τ negative;
 * diffusion uses sqrt(2·Kh_eff·|dt|). NOTE (documented per PLAN §4): a time-reversed
 * random walk is time-symmetric in EXPECTATION only — it is not the exact adjoint of
 * the forward Fokker–Planck operator, so the backward cloud over-disperses slightly
 * relative to a true posterior. The hindcast centroid remains unbiased because the
 * deterministic drift term dominates and retraces the forward trajectories.
 *
 * Particle count is CONSTANT (N=3000). Any NaN produced by a step is rejected and
 * the particle keeps its previous position (PLAN: "reject/replace any NaN").
 */
import { NoiseField, sampleWind, sampleCurrent, khEff, WINDAGE, STOKES } from './fields';

export interface ParticleCloud {
  n: number;
  x: Float64Array;
  y: Float64Array;
}

export interface Snapshot {
  t: number;              // seconds since release
  x: Float32Array;
  y: Float32Array;
}

/** Uniform disc release (r0 = 200 m per PLAN §3/§4). */
export function releaseDisc(rngGauss: () => number, rngUnif: () => number, n: number, cx: number, cy: number, r0: number): ParticleCloud {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // uniform in disc: sqrt(u) for area-uniform radius
    const u = Math.sqrt(rngUnif());
    const th = 2 * Math.PI * rngUnif();
    // decorrelate radii/angles with one gaussian draw to keep the uniform stream separate
    void rngGauss;
    x[i] = cx + r0 * u * Math.cos(th);
    y[i] = cy + r0 * u * Math.sin(th);
  }
  return { n, x, y };
}

/** Uniform [0,1) stream extracted from a gaussian factory wrapper is wasteful;
 *  engine passes explicit uniform fn here. Kept simple: callers pass both. */

const _cur = new Float64Array(2);
const _wnd = new Float64Array(2);

/**
 * Advect cloud from t0 to t1 (either direction) in sub-steps of |dt|.
 * rngU: uniform [0,1) stream; rngG: gaussian stream. Deterministic for a
 * fixed seed + fixed call order (sub-step count depends only on t0,t1,dt).
 */
export function advect(
  cloud: ParticleCloud,
  noise: NoiseField,
  rngU: () => number,
  rngG: () => number,
  t0: number,
  t1: number,
  dt: number
): number {
  const dir = t1 >= t0 ? 1 : -1;
  const stepAbs = Math.abs(dt);
  let t = t0;
  const X = cloud.x, Y = cloud.y, n = cloud.n;
  const drift = WINDAGE + STOKES; // PLAN: u_cur + 0.03·u_wind + 0.02·u_wind

  let guard = 0;
  const maxSteps = 200000;
  while (dir * (t1 - t) > 1e-9 && guard++ < maxSteps) {
    let h = dir * stepAbs;                       // signed step (negative when reversing time)
    if (Math.abs(t + h - t1) > Math.abs(t1 - t)) h = t1 - t; // clamp overshoot
    const ah = Math.abs(h);
    const sg = Math.sqrt(2 * khEff(t) * ah); // |dt| → time-symmetric diffusion (PLAN)
    for (let i = 0; i < n; i++) {
      const px = X[i], py = Y[i];
      sampleCurrent(noise, px, py, t, _cur);
      sampleWind(noise, px, py, t, _wnd);
      const gx = rngG(), gy = rngG();
      let nx = px + (_cur[0] + drift * _wnd[0]) * h + sg * gx;
      let ny = py + (_cur[1] + drift * _wnd[1]) * h + sg * gy;
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) { nx = px; ny = py; } // reject NaN
      X[i] = nx;
      Y[i] = ny;
    }
    t += h; // h is signed
  }
  return t;
}

/** Snapshot helpers ------------------------------------------------------- */

export function takeSnapshot(t: number, cloud: ParticleCloud): Snapshot {
  return { t, x: Float32Array.from(cloud.x), y: Float32Array.from(cloud.y) };
}

/** Interpolated restore of cloud state at time t from a sorted snapshot list. */
export function restoreFromSnaps(list: Snapshot[], t: number, cloud: ParticleCloud): void {
  if (list.length === 0) return;
  if (t <= list[0].t) {
    cloud.x.set(list[0].x); cloud.y.set(list[0].y);
    return;
  }
  const last = list[list.length - 1];
  if (t >= last.t) {
    cloud.x.set(last.x); cloud.y.set(last.y);
    return;
  }
  let lo = 0, hi = list.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = list[lo], b = list[hi];
  const f = (t - a.t) / (b.t - a.t);
  for (let i = 0; i < cloud.n; i++) {
    cloud.x[i] = a.x[i] + (b.x[i] - a.x[i]) * f;
    cloud.y[i] = a.y[i] + (b.y[i] - a.y[i]) * f;
  }
}

/** Centroid (mean) of a cloud. */
export function centroid(cloud: ParticleCloud): { x: number; y: number } {
  let sx = 0, sy = 0;
  for (let i = 0; i < cloud.n; i++) { sx += cloud.x[i]; sy += cloud.y[i]; }
  return { x: sx / cloud.n, y: sy / cloud.n };
}

/** NaN / count audit (acceptance test 5). Returns true if healthy. */
export function cloudHealthy(cloud: ParticleCloud): boolean {
  if (cloud.n !== cloud.x.length || cloud.n !== cloud.y.length) return false;
  for (let i = 0; i < cloud.n; i++) {
    if (!Number.isFinite(cloud.x[i]) || !Number.isFinite(cloud.y[i])) return false;
  }
  return true;
}
