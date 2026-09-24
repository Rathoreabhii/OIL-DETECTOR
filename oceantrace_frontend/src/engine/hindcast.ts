/**
 * OCEANTRACE — Backward hindcast → source estimate + uncertainty ellipse (PLAN §4).
 *
 * 1. Backward advect detection-state particles T_det → T_src (36 h, 1 h blocks,
 *    120 s sub-steps — blocks give hourly trajectory points for display).
 * 2. Source estimate = centroid of backward particles at T_src.
 *    Uncertainty ellipse = 2σ covariance ellipse (a, b, θ); "±X km" = semi-major.
 * 3. Backward diffusion uses sqrt(2·Kh_eff·|dt|) — time-symmetric in expectation
 *    (documented in particles.ts per PLAN §4).
 */
import { NoiseField } from './fields';
import { ParticleCloud, advect, centroid } from './particles';

export interface HindcastResult {
  estX: number; estY: number;          // m — centroid of backward cloud at T_src
  covA: number; covB: number; covTheta: number; // 2σ ellipse: semi-major/minor (m), rotation (rad)
  backPath: Float64Array;              // flat [x,y,…] hourly centroid path T_det→T_src
  cloud: ParticleCloud;                // backward cloud at T_src (for trajectory intersection)
  dist: Float64Array;                  // per-axis std at T_src (m)
}

/** Eigen-decomposition of 2×2 covariance → 2σ ellipse parameters. */
export function covarianceEllipse(sxx: number, syy: number, sxy: number, k = 2): { a: number; b: number; theta: number } {
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.max(0, (tr * tr) / 4 - det);
  const l1 = tr / 2 + Math.sqrt(disc);
  const l2 = Math.max(0, tr / 2 - Math.sqrt(disc));
  const a = k * Math.sqrt(Math.max(l1, 0));
  const b = k * Math.sqrt(Math.max(l2, 0));
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { a, b, theta };
}

export interface BackwardRunState {
  cloud: ParticleCloud;
  t: number;              // current model time (s since release)
  path: number[];         // flat hourly centroid positions
  done: boolean;
}

/** Start a backward hindcast from the detection-time cloud (T_det → T_src). */
export function beginBackward(cloudAtDet: ParticleCloud): BackwardRunState {
  return {
    cloud: { n: cloudAtDet.n, x: Float64Array.from(cloudAtDet.x), y: Float64Array.from(cloudAtDet.y) },
    t: 129600,
    path: [],
    done: false
  };
}

/**
 * Advance a backward run by one 1-hour block (with 120 s sub-steps), recording
 * the hourly centroid. Returns true when T_src (t=0) is reached.
 */
export function stepBackward(st: BackwardRunState, noise: NoiseField, rngU: () => number, rngG: () => number): boolean {
  if (st.done) return true;
  const c0 = centroid(st.cloud);
  st.path.push(c0.x, c0.y);
  const target = Math.max(0, st.t - 3600);
  st.t = advect(st.cloud, noise, rngU, rngG, st.t, target, -120);
  if (st.t <= 0 + 1e-6) {
    st.done = true;
    return true;
  }
  return false;
}

/** Finalise: centroid + 2σ covariance ellipse at T_src. */
export function finishBackward(st: BackwardRunState): HindcastResult {
  const c = centroid(st.cloud);
  st.path.push(c.x, c.y); // final point at T_src (path = 37 hourly points)
  let sxx = 0, syy = 0, sxy = 0;
  const n = st.cloud.n;
  for (let i = 0; i < n; i++) {
    const dx = st.cloud.x[i] - c.x, dy = st.cloud.y[i] - c.y;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  sxx /= n; syy /= n; sxy /= n;
  const ell = covarianceEllipse(sxx, syy, sxy, 2);
  return {
    estX: c.x,
    estY: c.y,
    covA: ell.a,
    covB: ell.b,
    covTheta: ell.theta,
    backPath: Float64Array.from(st.path),
    cloud: st.cloud,
    dist: Float64Array.from([Math.sqrt(sxx), Math.sqrt(syy)])
  };
}

/** Forward validation release at the estimate (same duration, derived RNG). */
export function beginForwardValidation(estX: number, estY: number, rngU: () => number, rngG: () => number, n: number, r0: number): { cloud: ParticleCloud; t: number; path: number[]; done: boolean; rngU: () => number; rngG: () => number } {
  const cloud: ParticleCloud = { n, x: new Float64Array(n), y: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    const u = Math.sqrt(rngU());
    const th = 2 * Math.PI * rngU();
    cloud.x[i] = estX + r0 * u * Math.cos(th);
    cloud.y[i] = estY + r0 * u * Math.sin(th);
  }
  return { cloud, t: 0, path: [], done: false, rngU, rngG };
}

/** Advance forward validation by one hour; returns true when T_det reached. */
export function stepForwardValidation(st: ReturnType<typeof beginForwardValidation>, noise: NoiseField): boolean {
  if (st.done) return true;
  let sx = 0, sy = 0;
  for (let i = 0; i < st.cloud.n; i++) { sx += st.cloud.x[i]; sy += st.cloud.y[i]; }
  st.path.push(sx / st.cloud.n, sy / st.cloud.n);
  const target = Math.min(129600, st.t + 3600);
  st.t = advect(st.cloud, noise, st.rngU, st.rngG, st.t, target, 120);
  if (st.t >= 129600 - 1e-6) { st.done = true; return true; }
  return false;
}
