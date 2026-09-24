/**
 * OCEANTRACE — Weighted AIS candidate scoring rubric (PLAN §4, Σ=100).
 *
 *   distance to estimated source : ≤5 km:40  ≤15:30  ≤30:18  else 8
 *   vessel type                  : Oil/Chemical tanker:30  Bulk:18  Cargo:12
 *   speed anomaly at discharge   : <0.5 kn:20  <3 kn:14  else 5
 *   time proximity               : ≤30 min:10  ≤2 h:7  ≤6 h:4  else 1
 *   trajectory intersection      : hit:8  near:5  no:0
 *   loitering                    : ≥2 h:5  ≥1 h:3  >0:1
 *
 * Every component's computed value AND awarded points are reported so the
 * "Why #1?" table can display both. No hardcoded totals.
 */
import { Vessel, posAt, speedAtKn, stwAtKn } from './vessels';
import { ParticleCloud } from './particles';
import { KM_LAT, KM_LON } from './fields';

export interface ScoreComponent {
  label: string;
  value: string;   // human-readable computed value
  points: number;  // awarded points
  max: number;     // max possible
}

export interface CandidateScore {
  vessel: Vessel;
  total: number;
  components: ScoreComponent[];
  /** raw geometry used (for modal / debugging) */
  raw: {
    distKm: number;
    speedKn: number;
    timeGapMin: number;
    trajHit: 'hit' | 'near' | 'no';
    loiterH: number;
  };
}

const ptsDistance = (km: number): number => (km <= 5 ? 40 : km <= 15 ? 30 : km <= 30 ? 18 : 8);
const ptsType = (cls: string): number => (cls === 'Oil Tanker' || cls === 'Chemical Tanker' ? 30 : cls === 'Bulk Carrier' ? 18 : 12);
const ptsSpeed = (kn: number): number => (kn < 0.5 ? 20 : kn < 3 ? 14 : 5);
const ptsTime = (min: number): number => (min <= 30 ? 10 : min <= 120 ? 7 : min <= 360 ? 4 : 1);

/** Longest slow (<1 kn through-water) run in the vessel's track within [tFrom,tTo] (hours).
 *  Loitering is judged on STW (engine behaviour), not SOG — a hull holding station
 *  against a current shows AIS SOG > 1 kn while it is in fact loitering. */
export function loiterHours(v: Vessel, tFrom: number, tTo: number): number {
  let best = 0, run = 0;
  const stepS = 120;
  const n = Math.floor((tTo - tFrom) / stepS);
  for (let i = 0; i <= n; i++) {
    const t = tFrom + i * stepS;
    if (t < v.t0 || t > v.t1) { if (run > 0) { best = Math.max(best, run); run = 0; } continue; }
    if (stwAtKn(v, t) < 1.0) {
      run += stepS / 3600;
    } else {
      best = Math.max(best, run);
      run = 0;
    }
  }
  best = Math.max(best, run);
  return best;
}

/** Does the vessel track pass through the backward cloud? (hit ≤1 cell, near ≤3 cells) */
export function trajectoryIntersection(v: Vessel, cloud: ParticleCloud, tFrom: number, tTo: number): 'hit' | 'near' | 'no' {
  const CELL = 2000; // 2 km grid
  const set = new Set<number>();
  for (let i = 0; i < cloud.n; i++) {
    const gx = Math.floor(cloud.x[i] / CELL), gy = Math.floor(cloud.y[i] / CELL);
    set.add(gy * 100000 + gx);
  }
  const buf = new Float64Array(2);
  const stepS = 600;
  let bestRing = 99; // 0 = through cloud, 1..3 = near rings
  const n = Math.floor((tTo - tFrom) / stepS);
  for (let i = 0; i <= n; i++) {
    const t = tFrom + i * stepS;
    if (t < v.t0 || t > v.t1) continue;
    if (!posAt(v, t, buf)) continue;
    const gx = Math.floor(buf[0] / CELL), gy = Math.floor(buf[1] / CELL);
    if (set.has(gy * 100000 + gx)) { bestRing = 0; break; }
    for (let r = 1; r <= 3; r++) {
      let found = false;
      for (let dx = -r; dx <= r && !found; dx++) {
        for (let dy = -r; dy <= r && !found; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (set.has((gy + dy) * 100000 + (gx + dx))) found = true;
        }
      }
      if (found) { bestRing = Math.min(bestRing, r); break; }
    }
    if (bestRing === 0) break;
  }
  return bestRing === 0 ? 'hit' : bestRing <= 1 ? 'near' : 'no';
}

/**
 * Score one vessel against the hindcast result.
 * @param dischargeT seconds-since-release of reconstructed discharge instant
 */
export function scoreCandidate(
  v: Vessel,
  estX: number,
  estY: number,
  dischargeT: number,
  backwardCloud: ParticleCloud,
  tWindowFrom: number,
  tWindowTo: number
): CandidateScore {
  // --- distance at reconstructed discharge time ---
  const buf = new Float64Array(2);
  let distKm = Infinity;
  let speedKn = 99;
  let timeGapMin = Infinity;
  if (posAt(v, dischargeT, buf)) {
    const dx = buf[0] - estX, dy = buf[1] - estY;
    distKm = Math.sqrt(dx * dx + dy * dy) / 1000;
    speedKn = stwAtKn(v, dischargeT); // speed anomaly judged through-water (engine effort)
    timeGapMin = 0;
  } else {
    // find closest approach within the search window
    const stepS = 300;
    const n = Math.floor((tWindowTo - tWindowFrom) / stepS);
    for (let i = 0; i <= n; i++) {
      const t = tWindowFrom + i * stepS;
      if (t < v.t0 || t > v.t1) continue;
      if (!posAt(v, t, buf)) continue;
      const d = Math.hypot(buf[0] - estX, buf[1] - estY);
      if (d < distKm) { distKm = d; speedKn = stwAtKn(v, t); timeGapMin = Math.abs(t - dischargeT) / 60; }
    }
    if (!Number.isFinite(distKm)) { distKm = 999; speedKn = 99; timeGapMin = 9999; }
  }

  const loiterH = loiterHours(v, tWindowFrom, tWindowTo);
  const traj = trajectoryIntersection(v, backwardCloud, tWindowFrom, tWindowTo);

  const pDist = ptsDistance(distKm);
  const pType = ptsType(v.def.cls);
  const pSpeed = ptsSpeed(speedKn);
  const pTime = ptsTime(timeGapMin);
  const pTraj = traj === 'hit' ? 8 : traj === 'near' ? 5 : 0;
  const pLoit = loiterH >= 2 ? 5 : loiterH >= 1 ? 3 : loiterH > 0 ? 1 : 0;

  const components: ScoreComponent[] = [
    { label: 'Distance to source', value: fmt(distKm, 1) + ' km', points: pDist, max: 40 },
    { label: 'Vessel type', value: v.def.cls, points: pType, max: 30 },
    { label: 'Speed anomaly', value: fmt(speedKn, 2) + ' kn', points: pSpeed, max: 20 },
    { label: 'Time proximity', value: timeGapMin <= 30 ? 'at discharge' : fmt(timeGapMin, 0) + ' min', points: pTime, max: 10 },
    { label: 'Trajectory intersection', value: traj === 'hit' ? 'through cloud' : traj === 'near' ? 'near cloud' : 'clear', points: pTraj, max: 8 },
    { label: 'Loitering', value: loiterH > 0 ? fmt(loiterH, 1) + ' h' : 'none', points: pLoit, max: 5 }
  ];

  const total = pDist + pType + pSpeed + pTime + pTraj + pLoit;
  return {
    vessel: v,
    total,
    components,
    raw: { distKm, speedKn, timeGapMin, trajHit: traj, loiterH }
  };
}

function fmt(v: number, d: number): string {
  return Number.isFinite(v) ? v.toFixed(d) : '—';
}

/** Rank all candidates (descending total). */
export function rankCandidates(scores: CandidateScore[]): CandidateScore[] {
  return [...scores].sort((a, b) => b.total - a.total || a.raw.distKm - b.raw.distKm);
}
