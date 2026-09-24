/**
 * OCEANTRACE — Physics-driven synthetic AIS vessel fleet (PLAN §4 "AIS vessels & scoring").
 *
 * v2.1 — vessels are no longer canned waypoint animation. Every hull is INTEGRATED
 * through the same deterministic wind/current fields the oil particles feel:
 *
 *   v_ground(t+dt) = surge(v_cmd) + v_current(x,t) + LEWAY · v_wind(x,t)
 *   x(t+dt)        = x(t) + v_ground · dt          (Euler, dt = 60 s)
 *
 *  - v_cmd comes from a guidance controller that follows the dispatch schedule:
 *      · 'arrive' legs → proportional steering to hit the waypoint at its
 *        scheduled hour (closed-loop, so wind/current drift gets compensated).
 *      · 'drift' legs  → constant commanded course/speed (dead-reckoned).
 *      · loiter legs (cmd speed < 0.5 kn) additionally get dynamic-positioning
 *        station-keeping: a weak pull (τ ≈ 30 min) toward the hold point, so the
 *        hull visibly wanders with wind/current but stays near the spill origin.
 *  - surge: first-order hull response (τ = 120 s) — engines can't teleport speed.
 *  - V_LEWAY = 0.02: hull windage (2 % of wind speed ≈ 0.16 m/s at 8 m/s),
 *    standard leeway coefficient for merchant freeboards.
 *
 * Trajectories are pre-integrated ONCE per build (deterministic — no RNG, the
 * noise fields are seeded) and sampled every 60 s; posAt/speedAtKn/headingAt
 * interpolate the stored track. Times are seconds relative to release
 * T_src_true (t=0); T_det = +36 h.
 */
import { NoiseField, sampleWind, sampleCurrent, lonToX, latToY, KM_LAT, KM_LON } from './fields';

export type VesselClass = 'Oil Tanker' | 'Chemical Tanker' | 'Cargo' | 'Bulk Carrier';

export interface VesselDef {
  name: string;
  cls: VesselClass;
  mmsi: number;
  color: string;
}

export interface Leg {
  kind: 'arrive' | 'drift';
  /** arrive: destination + absolute arrival hour (dispatch schedule). drift: constant commanded course/speed. */
  lon?: number; lat?: number; atH?: number;
  speedKn?: number; bearingDeg?: number; durH?: number;
}

export interface Vessel {
  def: VesselDef;
  t0: number;             // s
  t1: number;             // s
  legs: Leg[];            // dispatch schedule (guidance reference)
  legT0: Float64Array;    // per-leg start time (s)
  legDur: Float64Array;   // per-leg duration (s)
  legTgt: Float64Array;   // arrive legs: target (x,y) metres east/north
  legCmd: Float64Array;   // drift legs: commanded velocity (vx,vy) m/s
  // ---- pre-integrated physics track (dt = V_DT) ----
  ts: Float64Array;       // time (s)
  xs: Float64Array;       // metres east
  ys: Float64Array;       // metres north
  sogKn: Float64Array;    // speed over ground (kn) — includes wind/current drift
  stwKn: Float64Array;    // speed through water (kn) — ground speed minus current (leeway included)
  hdgDeg: Float64Array;   // course over ground (deg from north, clockwise)
}

export const KN = 0.514444; // m/s per knot

// ---- vessel physics constants (documented per PLAN physics rules) ----
/** hull leeway: fraction of wind speed the hull drifts downwind */
export const V_LEWAY = 0.02;
/** water-column advection gain (vessels ride the current fully) */
export const V_CURRENT_GAIN = 1.0;
/** integration step (s) */
export const V_DT = 60;
/** surge time constant (s) — first-order hull response to commanded velocity */
export const V_TAU_SURGE = 120;
/** dynamic-positioning station-keeping gain during loiter (1/s, τ ≈ 30 min) */
export const V_HOLD_K = 1 / 1800;
/** guidance speed clamp (kn) */
export const V_MAX_KN = 16;
/** guidance remaining-time floor (s) — smooth deceleration into waypoints */
export const V_GUIDE_FLOOR = 900;

/** Resolve the dispatch schedule into per-leg boundaries/targets/commands. */
function buildSchedule(t0s: number, legs: Leg[]): { legT0: Float64Array; legDur: Float64Array; legTgt: Float64Array; legCmd: Float64Array; t1: number } {
  const n = legs.length;
  const legT0 = new Float64Array(n);
  const legDur = new Float64Array(n);
  const legTgt = new Float64Array(n * 2);
  const legCmd = new Float64Array(n * 2);
  let t = t0s;
  for (let i = 0; i < n; i++) {
    const L = legs[i];
    legT0[i] = t;
    if (L.kind === 'arrive') {
      legTgt[i * 2] = lonToX(L.lon!);
      legTgt[i * 2 + 1] = latToY(L.lat!);
      const dur = (L.atH! * 3600) - t;
      legDur[i] = dur > 0 ? dur : 0;
      t += legDur[i];
    } else {
      const sp = L.speedKn! * KN;
      const br = (L.bearingDeg! * Math.PI) / 180;
      legCmd[i * 2] = sp * Math.sin(br);
      legCmd[i * 2 + 1] = sp * Math.cos(br);
      const dur = L.durH! * 3600;
      legDur[i] = dur;
      t += dur;
    }
  }
  return { legT0, legDur, legTgt, legCmd, t1: t };
}

function legIndexAt(v: Vessel, t: number): number {
  const n = v.legs.length;
  for (let i = 0; i < n; i++) {
    if (t <= v.legT0[i] + v.legDur[i] + 1e-6) return i;
  }
  return n - 1;
}

/** Pre-integrate the physics trajectory once (deterministic; no RNG). */
function integrateTrack(v: Vessel, noise: NoiseField, startX: number, startY: number): void {
  const dt = V_DT;
  const n = Math.max(2, Math.round((v.t1 - v.t0) / dt) + 1);
  v.ts = new Float64Array(n);
  v.xs = new Float64Array(n);
  v.ys = new Float64Array(n);
  v.sogKn = new Float64Array(n);
  v.stwKn = new Float64Array(n);
  v.hdgDeg = new Float64Array(n);

  const cur = new Float64Array(2);
  const wind = new Float64Array(2);
  let x = startX, y = startY;
  let vx = 0, vy = 0;
  let curLeg = -1;
  let holdX = 0, holdY = 0; // loiter hold point (captured when the loiter leg begins)

  // hull is already UNDERWAY at first observation — seed surge with leg-0
  // commanded velocity so there is no artificial start-from-rest artifact.
  {
    const li0 = 0;
    if (v.legs[li0].kind === 'arrive') {
      const rem = Math.max((v.legT0[li0] + v.legDur[li0]) - v.t0, V_GUIDE_FLOOR);
      vx = (v.legTgt[li0 * 2] - x) / rem;
      vy = (v.legTgt[li0 * 2 + 1] - y) / rem;
      const sp = Math.hypot(vx, vy);
      const maxs = V_MAX_KN * KN;
      if (sp > maxs) { vx = (vx / sp) * maxs; vy = (vy / sp) * maxs; }
    } else {
      vx = v.legCmd[li0 * 2];
      vy = v.legCmd[li0 * 2 + 1];
    }
  }

  for (let i = 0; i < n; i++) {
    const t = v.t0 + i * dt;
    v.ts[i] = t;
    if (i === 0) {
      v.xs[0] = x; v.ys[0] = y;
      v.sogKn[0] = 0; v.stwKn[0] = 0; v.hdgDeg[0] = 0;
      continue;
    }
    const li = legIndexAt(v, Math.min(t, v.t1) - 1e-3);
    if (li !== curLeg) {
      curLeg = li;
      if (v.legs[li].kind === 'drift' && (v.legs[li].speedKn ?? 9) < 0.5) {
        holdX = x; holdY = y; // capture hold point at loiter start
      }
    }

    // --- guidance: commanded velocity for this leg ---
    let tx: number, ty: number;
    if (v.legs[li].kind === 'arrive') {
      const rem = Math.max((v.legT0[li] + v.legDur[li]) - t, V_GUIDE_FLOOR);
      tx = (v.legTgt[li * 2] - x) / rem;
      ty = (v.legTgt[li * 2 + 1] - y) / rem;
      const sp = Math.hypot(tx, ty);
      const maxs = V_MAX_KN * KN;
      if (sp > maxs) { tx = (tx / sp) * maxs; ty = (ty / sp) * maxs; }
    } else {
      tx = v.legCmd[li * 2];
      ty = v.legCmd[li * 2 + 1];
      if ((v.legs[li].speedKn ?? 9) < 0.5) {
        // dynamic positioning: weak pull toward the hold point
        tx += V_HOLD_K * (holdX - x);
        ty += V_HOLD_K * (holdY - y);
      }
    }

    // --- environment at the hull's position (same fields the oil feels) ---
    sampleCurrent(noise, x, y, t, cur);
    sampleWind(noise, x, y, t, wind);
    const wtx = tx + V_CURRENT_GAIN * cur[0] + V_LEWAY * wind[0];
    const wty = ty + V_CURRENT_GAIN * cur[1] + V_LEWAY * wind[1];

    // --- surge: first-order hull response, then Euler step ---
    const a = Math.min(1, dt / V_TAU_SURGE);
    vx += (wtx - vx) * a;
    vy += (wty - vy) * a;
    x += vx * dt;
    y += vy * dt;
    v.xs[i] = x;
    v.ys[i] = y;
    v.sogKn[i] = Math.hypot(vx, vy) / KN;
    v.stwKn[i] = Math.hypot(vx - cur[0], vy - cur[1]) / KN;
    v.hdgDeg[i] = (Math.atan2(vx, vy) * 180) / Math.PI;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      x = v.xs[i - 1]; y = v.ys[i - 1]; vx = 0; vy = 0; // paranoia guard
      v.xs[i] = x; v.ys[i] = y; v.sogKn[i] = 0; v.stwKn[i] = 0; v.hdgDeg[i] = 0;
    }
  }
}

export function buildVessel(def: VesselDef, t0H: number, startLon: number, startLat: number, legs: Leg[], noise: NoiseField): Vessel {
  const t0 = t0H * 3600;
  const sched = buildSchedule(t0, legs);
  const v: Vessel = {
    def, t0, t1: sched.t1, legs,
    legT0: sched.legT0, legDur: sched.legDur, legTgt: sched.legTgt, legCmd: sched.legCmd,
    ts: new Float64Array(0), xs: new Float64Array(0), ys: new Float64Array(0),
    sogKn: new Float64Array(0), stwKn: new Float64Array(0), hdgDeg: new Float64Array(0)
  };
  integrateTrack(v, noise, lonToX(startLon), latToY(startLat));
  return v;
}

/** Position at time t (seconds since release). Returns false outside track span. */
export function posAt(v: Vessel, t: number, out: Float64Array): boolean {
  if (t < v.t0 - 1e-6 || t > v.t1 + 1e-6) return false;
  const f = (t - v.t0) / V_DT;
  const i = Math.max(0, Math.min(v.ts.length - 2, Math.floor(f)));
  const a = Math.min(1, Math.max(0, f - i));
  out[0] = v.xs[i] + (v.xs[i + 1] - v.xs[i]) * a;
  out[1] = v.ys[i] + (v.ys[i + 1] - v.ys[i]) * a;
  return true;
}

/** Speed over ground in knots at time t (includes wind/current drift; 0 outside span). */
export function speedAtKn(v: Vessel, t: number): number {
  if (t < v.t0 - 1e-6 || t > v.t1 + 1e-6) return 0;
  const f = (t - v.t0) / V_DT;
  const i = Math.max(0, Math.min(v.sogKn.length - 2, Math.floor(f)));
  const a = Math.min(1, Math.max(0, f - i));
  return v.sogKn[i] + (v.sogKn[i + 1] - v.sogKn[i]) * a;
}

/** Speed through water in knots at time t (ground speed minus current; 0 outside span). */
export function stwAtKn(v: Vessel, t: number): number {
  if (t < v.t0 - 1e-6 || t > v.t1 + 1e-6) return 0;
  const f = (t - v.t0) / V_DT;
  const i = Math.max(0, Math.min(v.stwKn.length - 2, Math.floor(f)));
  const a = Math.min(1, Math.max(0, f - i));
  return v.stwKn[i] + (v.stwKn[i + 1] - v.stwKn[i]) * a;
}

function lerpDeg(a: number, b: number, f: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * f + 360) % 360;
}

/** Heading / course over ground (degrees from north, clockwise) at time t. */
export function headingAt(v: Vessel, t: number): number {
  if (t < v.t0 || t > v.t1) return 0;
  const f = (t - v.t0) / V_DT;
  const i = Math.max(0, Math.min(v.hdgDeg.length - 2, Math.floor(f)));
  const a = Math.min(1, Math.max(0, f - i));
  return lerpDeg(v.hdgDeg[i], v.hdgDeg[i + 1], a);
}

/* --------------------------------------------------------------------------
 * Fleet definition (PLAN §4). Ocean Pride's loiter window is placed so its
 * closest approach to the source ends 1.8 h before the reconstructed discharge
 * instant; the rubric then computes its score from the actual geometry. The
 * acceptance test expects that geometry to yield a total of 96±3.
 * -------------------------------------------------------------------------- */

export function buildFleet(trueLon: number, trueLat: number, noise: NoiseField): Vessel[] {
  // Point offset from the true source, east/north in km (linear geo model).
  const off = (dxE: number, dyN: number): { lon: number; lat: number } => ({
    lon: trueLon + (dxE / KM_LON),
    lat: trueLat + (dyN / KM_LAT)
  });

  // Loiter start: 1.2 km EAST of source; station-keep 0.2 kn westward 2.1 h
  // (wind/current now visibly drift the hull around the hold point).
  const L0 = off(1.2, 0);
  const pass12E = off(12, 0);   // Eastern Trader pass point, 12 km E of source
  const pass18W = off(-18, 0);  // Sagar Shakti pass point, 18 km W of source

  const fleet: Vessel[] = [
    // 1 — MV Ocean Pride (Oil Tanker): approach → loiter → slow depart → transit out
    buildVessel(
      { name: 'MV Ocean Pride', cls: 'Oil Tanker', mmsi: 563214000, color: '#ff5c47' },
      -10, 70.9, 11.62,
      [
        { kind: 'arrive', lon: L0.lon, lat: L0.lat, atH: -3.9 },      // ≈10.6 kn approach
        { kind: 'drift', speedKn: 0.2, bearingDeg: 270, durH: 2.1 }, // LOITER (station-kept, env-drifted)
        { kind: 'drift', speedKn: 2.4, bearingDeg: 120, durH: 5.8 }, // slow departure
        { kind: 'drift', speedKn: 11.0, bearingDeg: 80, durH: 12 }   // transit away
      ],
      noise
    ),
    // 2 — MV Eastern Trader (Cargo): passes ~12 km E of source ~1 h before discharge
    buildVessel(
      { name: 'MV Eastern Trader', cls: 'Cargo', mmsi: 419001872, color: '#5ac8fa' },
      -7, 72.9, 12.9,
      [
        { kind: 'arrive', lon: pass12E.lon, lat: pass12E.lat, atH: -1 }, // ≈12.7 kn
        { kind: 'drift', speedKn: 7.0, bearingDeg: 125, durH: 6 },
        { kind: 'drift', speedKn: 11.0, bearingDeg: 69, durH: 4.2 }
      ],
      noise
    ),
    // 3 — MV Atlas Voyager (Cargo): far-north transiter
    buildVessel(
      { name: 'MV Atlas Voyager', cls: 'Cargo', mmsi: 565219000, color: '#5ac8fa' },
      -9, 70.8, 12.6,
      [
        { kind: 'arrive', lon: 71.7, lat: 12.45, atH: -4 },
        { kind: 'arrive', lon: 72.6, lat: 12.35, atH: 1 },
        { kind: 'drift', speedKn: 12.0, bearingDeg: 71, durH: 4 }
      ],
      noise
    ),
    // 4 — MV Sagar Shakti (Chemical Tanker): steady transit, passes ~18 km W at discharge
    //     (drift legs — a vessel passing through does NOT decelerate at the pass point)
    buildVessel(
      { name: 'MV Sagar Shakti', cls: 'Chemical Tanker', mmsi: 419000625, color: '#ffaa3d' },
      -7, 70.98, 11.88,
      [
        { kind: 'drift', speedKn: 11.4, bearingDeg: 79.2, durH: 7 },    // ≈11.4 kn run-in, at pass18W @ t=0
        { kind: 'drift', speedKn: 9.0, bearingDeg: 61, durH: 4.6 },
        { kind: 'drift', speedKn: 8.5, bearingDeg: 53, durH: 4.7 }
      ],
      noise
    ),
    // 5 — MV Neptune Glory (Bulk Carrier): far north
    buildVessel(
      { name: 'MV Neptune Glory', cls: 'Bulk Carrier', mmsi: 538007513, color: '#8fa8ff' },
      -8, 73.1, 13.3,
      [
        { kind: 'arrive', lon: 72.2, lat: 13.1, atH: -2 },
        { kind: 'drift', speedKn: 10.5, bearingDeg: 281, durH: 4.6 }
      ],
      noise
    ),
    // 6 — MV Coastal Star (Cargo): long transit along the southern edge
    buildVessel(
      { name: 'MV Coastal Star', cls: 'Cargo', mmsi: 419001234, color: '#5ac8fa' },
      -10, 70.7, 11.6,
      [
        { kind: 'drift', speedKn: 13.0, bearingDeg: 91, durH: 7 },
        { kind: 'drift', speedKn: 13.5, bearingDeg: 87, durH: 7 },
        { kind: 'drift', speedKn: 13.0, bearingDeg: 83, durH: 7 }
      ],
      noise
    )
  ];
  return fleet;
}

/** Sample a vessel track into flat polyline arrays (metres) for display/scoring. */
export function sampleTrack(v: Vessel, tFrom: number, tTo: number, stepS: number, out: { xs: number[]; ys: number[] }): void {
  out.xs.length = 0; out.ys.length = 0;
  const a = Math.max(v.t0, tFrom), b = Math.min(v.t1, tTo);
  for (let i = 0; i < v.ts.length; i++) {
    const t = v.ts[i];
    if (t < a - 1e-6) continue;
    if (t > b + 1e-6) break;
    out.xs.push(v.xs[i]);
    out.ys.push(v.ys[i]);
  }
}
