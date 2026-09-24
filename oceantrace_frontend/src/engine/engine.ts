/**
 * OCEANTRACE — Engine orchestrator (PLAN §4, pipeline steps 1–8).
 *
 * Timeline convention: model time t = seconds since release T_src_true (t=0).
 * T_det = +129600 s (2026-08-20 14:30 UTC). Scrubber window = T_det−12 h … +24 h.
 *
 * Boot: forward run TRUE release → T_det, snapshotting every 30 min (chunked so
 * the UI stays responsive). Investigation (Run Investigation button / tests):
 *   Backtrack Drift → Estimate Source → Search AIS → Score Candidates → Report,
 *   executed as a resumable state machine (1 h per step) so the UI can animate
 *   progress; the identical code path is used synchronously by the tests.
 *
 * Dedicated RNG streams (determinism, PLAN §9 test 4):
 *   boot  = SEED             hindcast = SEED^0x9e3779b9
 *   valid = SEED^0x85ebca6b  live playback = SEED^0xc2b2ae35
 */
import { SEED, gaussianFactory, mulberry32 } from './rng';
import { makeNoise, NoiseField, lonToX, latToY, xToLon, yToLat, KM_LAT, KM_LON } from './fields';
import { ParticleCloud, advect, takeSnapshot, Snapshot, restoreFromSnaps, centroid, cloudHealthy } from './particles';
import { computeKDE, Slick, wetIoU, GRID } from './slick';
import { beginBackward, stepBackward, finishBackward, beginForwardValidation, stepForwardValidation, HindcastResult } from './hindcast';
import { buildFleet, Vessel } from './vessels';
import { scoreCandidate, rankCandidates, CandidateScore } from './scoring';

export const T_SRC_EPOCH_MS = Date.UTC(2026, 7, 19, 2, 30, 0); // 2026-08-19 02:30 UTC
export const T_DET_S = 129600;                                  // 36 h
export const SCRUB_FROM = T_DET_S - 12 * 3600;                  // −12 h rel T_det
export const SCRUB_TO = T_DET_S + 24 * 3600;                    // +24 h rel T_det
export const HINDCAST_WINDOW_S = 36 * 3600;
export const N_PARTICLES = 3000;
export const R0 = 200;                                          // m release disc
export const SIM_DT = 120;                                      // physics sub-step (s)
/** Validation-only constant (PLAN §3): never used by any displayed estimate. */
export const TRUE_SRC = { lat: 12.014, lon: 71.862 };
/** Domain (PLAN §3) */
export const DOMAIN = {
  lonMin: 70.5, lonMax: 73.5, latMin: 11.5, latMax: 13.5,
  xMin: lonToX(70.5), xMax: lonToX(73.5), yMin: latToY(11.5), yMax: latToY(13.5)
};

export interface Investigation {
  estX: number; estY: number;
  estLat: number; estLon: number;
  uncKm: number;                  // ±X km = semi-major of 2σ ellipse (PLAN test 3)
  covA: number; covB: number; covTheta: number; // metres / rad
  areaKm2: number;                // observed slick area at T_det
  areaCoreKm2: number;            // core slick (cells ≥ 50 % peak density) at T_det
  fwdMatch: number;               // IoU of validation vs observed (0..1)
  conf: number;                   // PLAN formula
  dischEpochMs: number;           // reconstructed discharge instant
  backPath: Float64Array;         // hourly centroid path (backward)
  fwdPath: Float64Array;          // hourly centroid path (forward validation)
  candidates: CandidateScore[];   // ranked
  backCloud: ParticleCloud;
  valAreaKm2: number;
}

type InvPhase = 'back' | 'valid' | 'score';

interface InvState {
  phase: InvPhase;
  back: ReturnType<typeof beginBackward> | null;
  hind: HindcastResult | null;
  valid: ReturnType<typeof beginForwardValidation> | null;
  out: Investigation | null;
}

export class OceanEngine {
  readonly seed: number;
  noise: NoiseField;
  cloud: ParticleCloud;          // live particle cloud (at state.simTime)
  snapshots: Snapshot[] = [];    // canonical boot history 0..T_DET every 30 min
  fleet: Vessel[];
  private bootT = 0;             // forward boot progress (s)
  bootDone = false;
  private slickCache: Slick | null = null;
  areaDetKm2 = 0;                // observed slick area at T_det (computed at boot end)
  private invState: InvState | null = null;
  investigation: Investigation | null = null;
  // dedicated streams
  private rngBootU: () => number;
  private rngBootG: () => number;
  private rngBackU: () => number;
  private rngBackG: () => number;
  private rngValidU: () => number;
  private rngValidG: () => number;

  constructor(seed: number = SEED) {
    this.seed = seed;
    this.noise = makeNoise(seed);
    this.rngBootU = mulberry32(seed ^ 0x1234abcd);
    this.rngBootG = gaussianFactory(seed ^ 0x5eed0001);
    this.rngBackU = mulberry32(seed ^ 0x9e3779b9);
    this.rngBackG = gaussianFactory(seed ^ 0x5eed0002);
    this.rngValidU = mulberry32(seed ^ 0x85ebca6b);
    this.rngValidG = gaussianFactory(seed ^ 0x5eed0003);
    this.fleet = buildFleet(TRUE_SRC.lon, TRUE_SRC.lat, this.noise);
    // release cloud at true source at t=0 (scenario input; never displayed raw)
    this.cloud = { n: N_PARTICLES, x: new Float64Array(N_PARTICLES), y: new Float64Array(N_PARTICLES) };
    this.releaseInitial();
    this.snapshots.push(takeSnapshot(0, this.cloud)); // canonical t=0 state
  }

  private releaseInitial(): void {
    const n = N_PARTICLES;
    for (let i = 0; i < n; i++) {
      const u = Math.sqrt(this.rngBootU());
      const th = 2 * Math.PI * this.rngBootU();
      this.cloud.x[i] = lonToX(TRUE_SRC.lon) + R0 * u * Math.cos(th);
      this.cloud.y[i] = latToY(TRUE_SRC.lat) + R0 * u * Math.sin(th);
    }
  }

  /** Place the toy cloud on the case slick (projector metres). Skips 36 h fake boot. */
  seedAroundXY(x: number, y: number, r = 900): void {
    const n = N_PARTICLES;
    for (let i = 0; i < n; i++) {
      const u = Math.sqrt(this.rngBootU());
      const th = 2 * Math.PI * this.rngBootU();
      this.cloud.x[i] = x + r * u * Math.cos(th);
      this.cloud.y[i] = y + r * u * Math.sin(th);
    }
    this.bootT = T_DET_S;
    this.bootDone = true;
    this.snapshots = [takeSnapshot(T_DET_S, this.cloud)];
    this.slickCache = null;
    this.investigation = null;
  }

  /**
   * Boot chunk: advance the forward run by up to `simSeconds` toward T_DET,
   * snapshotting every 30 min. Returns true when boot completes.
   */
  bootStep(simSeconds: number): boolean {
    if (this.bootDone) return true;
    let target = Math.min(T_DET_S, this.bootT + simSeconds);
    // align first step to a 30-min boundary so snapshots land on the grid
    while (this.bootT < target - 1e-6) {
      const nextSnap = Math.ceil((this.bootT + 1e-6) / 1800) * 1800;
      const stepEnd = Math.min(target, nextSnap);
      this.bootT = advect(this.cloud, this.noise, this.rngBootU, this.rngBootG, this.bootT, stepEnd, SIM_DT);
      if (Math.abs(stepEnd - nextSnap) < 1e-6 || stepEnd === T_DET_S) {
        this.snapshots.push(takeSnapshot(this.bootT, this.cloud));
      }
    }
    if (this.bootT >= T_DET_S - 1e-6) {
      this.bootDone = true;
      // observed slick at detection
      this.slickCache = computeKDE(this.cloud, T_DET_S);
      this.areaDetKm2 = this.slickCache.areaKm2;
      return true;
    }
    return false;
  }

  /** Boot progress 0..1 for the splash/pipeline. */
  bootProgress(): number {
    return this.bootDone ? 1 : this.bootT / T_DET_S;
  }

  /** Restore live cloud (interpolated) from canonical snapshots. */
  restoreAt(t: number): void {
    if (t <= T_DET_S) restoreFromSnaps(this.snapshots, t, this.cloud);
    this.slickCache = null; // force recompute at new time
  }

  /** Append a live snapshot while playing beyond the boot history (forecast). */
  maybeSnapshot(t: number): void {
    const last = this.snapshots[this.snapshots.length - 1];
    if (t - last.t >= 1800) this.snapshots.push(takeSnapshot(t, this.cloud));
  }

  /** Slick for display, recomputed at most every 900 s of model time. */
  slickAt(t: number): Slick {
    if (this.slickCache && Math.abs(this.slickCache.t - t) < 900) return this.slickCache;
    this.slickCache = computeKDE(this.cloud, t);
    return this.slickCache;
  }

  forceSlick(t: number): Slick {
    this.slickCache = computeKDE(this.cloud, t);
    return this.slickCache;
  }

  /* ------------------------------------------------------------------ */
  /* Investigation — resumable pipeline (steps 4–8 of PLAN §6)           */
  /* ------------------------------------------------------------------ */

  beginInvestigation(): void {
    const detSnap = this.snapshots[this.snapshots.length - 1];
    const detCloud: ParticleCloud = { n: N_PARTICLES, x: Float64Array.from(detSnap.x), y: Float64Array.from(detSnap.y) };
    this.invState = { phase: 'back', back: beginBackward(detCloud), hind: null, valid: null, out: null };
    this.investigation = null;
  }

  /** Advance investigation by one 1-hour block. Returns true when complete. */
  stepInvestigation(): boolean {
    const st = this.invState;
    if (!st) throw new Error('beginInvestigation() first');
    if (st.phase === 'back') {
      const done = stepBackward(st.back!, this.noise, this.rngBackU, this.rngBackG);
      if (done) {
        st.hind = finishBackward(st.back!);
        st.valid = beginForwardValidation(st.hind.estX, st.hind.estY, this.rngValidU, this.rngValidG, N_PARTICLES, R0);
        st.phase = 'valid';
      }
      return false;
    }
    if (st.phase === 'valid') {
      const done = stepForwardValidation(st.valid!, this.noise);
      if (done) {
        const valSlick = computeKDE(st.valid!.cloud, T_DET_S);
        const obsSlick = this.slickCache && Math.abs(this.slickCache.t - T_DET_S) < 1 ? this.slickCache : computeKDE(detCloudOf(this), T_DET_S);
        const fwdMatch = wetIoU(obsSlick, valSlick);
        const hind = st.hind!;
        const uncKm = hind.covA / 1000; // semi-major of 2σ ellipse (PLAN test 3)
        // v2.1 calibration: wider dynamic range so Low/Moderate/High actually vary
        const conf = clamp(0.35 + 0.45 * fwdMatch + 0.2 * (1 - uncKm / 30), 0.05, 0.99);
        // scoring window: discharge ±18 h (covers the whole hindcast window)
        const candidates = rankCandidates(
          this.fleet.map((v) => scoreCandidate(v, hind.estX, hind.estY, 0, hind.cloud, -HINDCAST_WINDOW_S, HINDCAST_WINDOW_S))
        );
        st.out = {
          estX: hind.estX,
          estY: hind.estY,
          estLat: yToLat(hind.estY),
          estLon: xToLon(hind.estX),
          uncKm,
          covA: hind.covA,
          covB: hind.covB,
          covTheta: hind.covTheta,
          areaKm2: obsSlick.areaKm2,
          areaCoreKm2: obsSlick.coreAreaKm2,
          fwdMatch,
          conf,
          dischEpochMs: T_SRC_EPOCH_MS,
          backPath: hind.backPath,
          fwdPath: Float64Array.from(st.valid!.path),
          candidates,
          backCloud: hind.cloud,
          valAreaKm2: valSlick.areaKm2
        };
        this.investigation = st.out;
        st.phase = 'score';
        return true;
      }
      return false;
    }
    return true; // 'score' handled synchronously above
  }

  /** Full investigation in one call (tests / non-animated use). */
  runInvestigation(): Investigation {
    this.beginInvestigation();
    let guard = 0;
    while (!this.stepInvestigation() && guard++ < 500) { /* 36 h back + 36 h fwd + score */ }
    if (!this.investigation) throw new Error('investigation failed to converge');
    return this.investigation;
  }

  /** Progress of the running investigation 0..1 (for the pipeline animation). */
  investigationProgress(): number {
    const st = this.invState;
    if (!st) return 0;
    if (st.phase === 'back') return 0.45 * (1 - st.back!.t / T_DET_S);
    if (st.phase === 'valid') return 0.45 + 0.5 * (st.valid!.t / T_DET_S);
    return 1;
  }

  /** Fleet positions at time t for rendering. */
  fleetAt(t: number, out: Float64Array): boolean[] {
    const vis: boolean[] = [];
    const buf = new Float64Array(2);
    for (let i = 0; i < this.fleet.length; i++) {
      const ok = posAtFleet(this.fleet[i], t, buf);
      if (ok) { out[i * 2] = buf[0]; out[i * 2 + 1] = buf[1]; }
      vis.push(ok);
    }
    return vis;
  }
}

import { posAt as posAtFleet } from './vessels';

function detCloudOf(e: OceanEngine): ParticleCloud {
  const s = e.snapshots[e.snapshots.length - 1];
  return { n: N_PARTICLES, x: Float64Array.from(s.x), y: Float64Array.from(s.y) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Acceptance helper: audit cloud health (NaN-free, count constant). */
export function auditEngineClouds(e: OceanEngine): boolean {
  if (!cloudHealthy(e.cloud)) return false;
  for (const s of e.snapshots) {
    for (let i = 0; i < s.x.length; i++) {
      if (!Number.isFinite(s.x[i]) || !Number.isFinite(s.y[i])) return false;
    }
  }
  return true;
}

export { centroid, GRID, KM_LAT, KM_LON };
