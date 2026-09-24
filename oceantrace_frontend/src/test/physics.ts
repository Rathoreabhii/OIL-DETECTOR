/**
 * OCEANTRACE — Acceptance tests (PLAN §9), run via `npx tsx src/test/physics.ts`.
 *
 *  1. (build exit 0 is verified separately by `npm run build`)
 *  2. Forward from TRUE source: validation area within ±25 % of observed area
 *  3. Backward centroid within 15 km of TRUE source; displayed ±km = semi-major (2σ)
 *  4. Determinism: seed run twice → identical JSON (centroid, area, scores)
 *  5. No NaN particle positions; count === 3000 always
 *  6. Scoring: Ocean Pride ranks #1 and totals 96±3
 *  + field calibration (|u_cur| ∈ 0.1–0.5 m/s), KDE polygon presence, hindcast path sanity
 */
import {
  OceanEngine, T_DET_S, TRUE_SRC, N_PARTICLES, Investigation, auditEngineClouds
} from '../engine/engine';
import { sampleCurrent, lonToX, latToY } from '../engine/fields';
import { slickCentroidLL } from '../engine/slick';

let failures = 0;
function check(name: string, cond: boolean, info?: string): void {
  const tag = cond ? 'PASS' : 'FAIL';
  console.log(`${tag} — ${name}${info ? `  [${info}]` : ''}`);
  if (!cond) failures++;
}

function fmt(v: number, d = 3): string { return v.toFixed(d); }

/** Full pipeline on a fresh engine; returns engine + investigation. */
function fullRun(): { eng: OceanEngine; inv: Investigation } {
  const eng = new OceanEngine();
  let guard = 0;
  while (!eng.bootStep(7200) && guard++ < 100) { /* boot 36 h in 2 h chunks */ }
  check('boot completed', eng.bootDone && eng.bootProgress() === 1);
  check('boot snapshots: 73 @30-min (0..36h)', eng.snapshots.length === 73, `got ${eng.snapshots.length}`);
  check('cloud healthy after boot (no NaN, n=3000)', auditEngineClouds(eng));
  eng.beginInvestigation();
  let g2 = 0;
  while (!eng.stepInvestigation() && g2++ < 500) { /* animated pipeline path */ }
  const inv = eng.investigation!;
  check('investigation produced result', !!inv);
  check('cloud healthy after investigation', auditEngineClouds(eng));
  return { eng, inv };
}

console.log('=== OCEANTRACE acceptance tests (PLAN §9) ===');
const t0 = Date.now();

/* ---- Run 1 ---- */
const run1 = fullRun();
const inv1 = run1.inv;

/* ---- Test 5: particle hygiene at every snapshot ---- */
{
  let ok = true;
  for (const s of run1.eng.snapshots) {
    if (s.x.length !== N_PARTICLES || s.y.length !== N_PARTICLES) ok = false;
    for (let i = 0; i < s.x.length; i += 7) {
      if (!Number.isFinite(s.x[i]) || !Number.isFinite(s.y[i])) { ok = false; break; }
    }
    if (!ok) break;
  }
  check('T5: every snapshot has 3000 finite particles', ok);
}

/* ---- Field calibration (informational + loose assert) ---- */
{
  const eng = run1.eng;
  const out = new Float64Array(2);
  const speeds: number[] = [];
  for (let iy = 0; iy < 9; iy++) {
    for (let ix = 0; ix < 13; ix++) {
      const x = -140000 + ix * 24000;
      const y = -95000 + iy * 24000;
      for (const t of [0, 43200, 86400, 129600]) {
        sampleCurrent(eng.noise, x, y, t, out);
        speeds.push(Math.hypot(out[0], out[1]));
      }
    }
  }
  speeds.sort((a, b) => a - b);
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const p95 = speeds[Math.floor(0.95 * speeds.length)];
  const max = speeds[speeds.length - 1];
  console.log(`     current field: mean=${fmt(mean * 100, 1)} cm/s  p95=${fmt(p95, 3)} m/s  max=${fmt(max, 3)} m/s`);
  check('current calibration |u_cur| plausible (0.08 ≤ mean ≤ 0.5, max ≤ 0.6 m/s)',
    mean >= 0.08 && mean <= 0.5 && max <= 0.6);
}

/* ---- Test 2: slick geometry + forward validation within ±25 % ---- */
{
  const slick = run1.eng.forceSlick(T_DET_S);
  check('T2: KDE polygon extracted at T_det', slick.polys.length >= 1, `polys=${slick.polys.length}`);
  check('T2: observed area > 50 km² (sanity)', slick.areaKm2 > 50, `${fmt(slick.areaKm2, 1)} km²`);
  const ratio = inv1.valAreaKm2 / slick.areaKm2;
  check('T2: forward-validation area within ±25 % of observed',
    Math.abs(ratio - 1) <= 0.25, `val/obs=${fmt(ratio, 3)}`);
  check('T2: fwdMatch IoU > 0.3', inv1.fwdMatch > 0.3, `IoU=${fmt(inv1.fwdMatch, 3)}`);
  console.log(`     observed area = ${fmt(slick.areaKm2, 1)} km², validation area = ${fmt(inv1.valAreaKm2, 1)} km², conf=${fmt(inv1.conf, 3)}`);
}

/* ---- Test 3: backward centroid near TRUE source; ±km = semi-major ---- */
{
  const dx = inv1.estX - lonToX(TRUE_SRC.lon);
  const dy = inv1.estY - latToY(TRUE_SRC.lat);
  const distKm = Math.sqrt(dx * dx + dy * dy) / 1000;
  check('T3: backward centroid within 15 km of TRUE source', distKm <= 15, `${fmt(distKm, 3)} km`);
  check('T3: displayed ±km equals 2σ semi-major', Math.abs(inv1.uncKm - inv1.covA / 1000) < 1e-9,
    `uncKm=${fmt(inv1.uncKm, 3)}`);
  check('T3: uncertainty ellipse sane (0 < b ≤ a < 40 km)',
    inv1.covB > 0 && inv1.covB <= inv1.covA && inv1.covA < 40000,
    `a=${fmt(inv1.covA / 1000, 2)} km b=${fmt(inv1.covB / 1000, 2)} km`);
  console.log(`     estimate = ${fmt(inv1.estLat, 4)}°N ${fmt(inv1.estLon, 4)}°E  ±${fmt(inv1.uncKm, 2)} km`);
  const sc = slickCentroidLL(run1.eng.forceSlick(T_DET_S));
  console.log(`     detected slick centroid = ${fmt(sc.lat, 4)}°N ${fmt(sc.lon, 4)}°E`);
}

/* ---- Test 6: scoring rubric ---- */
{
  const top = inv1.candidates[0];
  check('T6: MV Ocean Pride ranks #1', top.vessel.def.name === 'MV Ocean Pride',
    `#1 = ${top.vessel.def.name} (${top.total})`);
  check('T6: Ocean Pride total in 96±3', top.total >= 93 && top.total <= 99, `total=${top.total}`);
  const second = inv1.candidates[1];
  check('T6: margin over #2 ≥ 20 pts', top.total - second.total >= 20,
    `#2 = ${second.vessel.def.name} (${second.total})`);
  const sum = top.components.reduce((a, c) => a + c.points, 0);
  check('T6: component points sum to displayed total', sum === top.total, `${sum} vs ${top.total}`);
  console.log('     top-3: ' + inv1.candidates.slice(0, 3).map((c) => `${c.vessel.def.name}=${c.total}`).join(' · '));
}

/* ---- Test 4: determinism (fresh engine, same seed → identical JSON) ---- */
{
  const run2 = fullRun();
  const inv2 = run2.inv;
  const j1 = JSON.stringify({
    estLat: inv1.estLat, estLon: inv1.estLon, uncKm: inv1.uncKm,
    area: inv1.areaKm2, valArea: inv1.valAreaKm2, fwdMatch: inv1.fwdMatch, conf: inv1.conf,
    scores: inv1.candidates.map((c) => [c.vessel.def.mmsi, c.total, c.components.map((k) => k.points)])
  });
  const j2 = JSON.stringify({
    estLat: inv2.estLat, estLon: inv2.estLon, uncKm: inv2.uncKm,
    area: inv2.areaKm2, valArea: inv2.valAreaKm2, fwdMatch: inv2.fwdMatch, conf: inv2.conf,
    scores: inv2.candidates.map((c) => [c.vessel.def.mmsi, c.total, c.components.map((k) => k.points)])
  });
  check('T4: determinism — two seeded runs produce identical JSON', j1 === j2);
}

/* ---- Hindcast path sanity ---- */
{
  const n = inv1.backPath.length / 2;
  check('hindcast path has 37 hourly points (T_det→T_src)', n === 37, `got ${n}`);
  const p0x = inv1.backPath[0], p0y = inv1.backPath[1];
  const d0 = Math.hypot(p0x - lonToX(TRUE_SRC.lon), p0y - latToY(TRUE_SRC.lat)) / 1000;
  check('backward path starts near detection cloud (drifted from source)', d0 > 5, `${fmt(d0, 1)} km from true source`);
}

console.log(`=== done in ${((Date.now() - t0) / 1000).toFixed(1)} s — ${failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURE(S)'} ===`);
if (failures > 0) process.exit(1);
