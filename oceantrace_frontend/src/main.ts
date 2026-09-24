/**
 * OCEANTRACE — bootstrap + game loop.
 *
 * Boot: GET /api/cases/case_001 → applyCase → seed particles at case centroid.
 * Run Investigation POSTs analyzeCase (Form env fields); panel reads API ranks.
 * Particle play stays as a toy overlay (state.playing can resume).
 */
import { OceanEngine, T_DET_S, SCRUB_FROM, SCRUB_TO, SIM_DT } from './engine/engine';
import { advect } from './engine/particles';
import { Vessel, posAt, speedAtKn, headingAt } from './engine/vessels';
import { mulberry32 } from './engine/rng';
import { state, on, emit } from './state';
import { Camera, makeCamera, clampPan, project, scale, COMPRESSION, zoomAt } from './render/camera';
import { drawOcean } from './render/ocean';
import {
  drawBaseMap, drawCurrents, drawWind, drawSAR, drawSpillPolygon, drawSpillBoundary,
  drawTrajectories, drawSourceRings, drawUncertainty, drawVesselTracks, drawVessels,
  drawParticles, drawSuspectLink, drawWeather, drawCaseTruth
} from './render/overlays';
import { API_CASE_ID, API_DOWN, CaseEnv, analyzeCase, fetchCase } from './api';
import { applyCase, caseCentroid, caseData, hoursRange, rankedVessels, setCaseError, vesselAtHours } from './caseView';
import { getProjector } from './geo';
import { buildHeader } from './ui/header';
import { buildLeftPanel, leftCamera, getMinimap } from './ui/leftPanel';
import { buildRightPanel, readEnvForm } from './ui/rightPanel';
import { buildTimeline } from './ui/timeline';
import { buildPipeline } from './ui/pipeline';
import { buildFooter } from './ui/footer';

/* ---------------- app skeleton ---------------- */
const app = document.getElementById('app')!;
app.innerHTML = `
  <header id="hdr" class="glass"></header>
  <main id="main">
    <aside id="left" class="glass"></aside>
    <section id="center">
      <canvas id="scene"></canvas>
      <div class="corner-tl">
        <div class="big">case_001 · Mumbai Approaches · demo</div>
        <div id="camInfo">CAM 2D · SEED 20260820</div>
        <div id="simInfo">—</div>
      </div>
      <div class="corner-br" id="brInfo">—</div>
      <div class="zoom-hint">wheel / pinch = zoom · drag = pan · double-tap = reset</div>
      <div class="map-legend" id="mapLegend">
        <div><i class="lg slick"></i> Oil slick — magenta fill + range rings (2.5–20 km)</div>
        <div><i class="lg forecast"></i> Yellow dash — leeway forecast (can leave the SAR frame)</div>
        <div><i class="lg back"></i> White — hindcast to source</div>
        <div><i class="lg src"></i> Green rings — estimated source</div>
        <div class="lg-note">Geo Map tab = Esri/OSM imagery, not Sentinel-1. Wheel zooms on the cursor.</div>
      </div>
      <div id="bootSplash">
        <div class="t">OCEANTRACE</div>
        <div class="s">Loading case_001 from FastAPI · not live SAR</div>
        <div class="bar"><i id="bootBar"></i></div>
        <div class="msg" id="bootMsg">Connecting to :8000…</div>
        <button type="button" id="bootRetry" class="boot-retry" hidden>Retry</button>
      </div>
    </section>
    <aside id="right" class="glass"></aside>
  </main>
  <section id="bottom" class="glass"></section>
  <footer id="ftr" class="glass"></footer>
  <div id="mobileTabs">
    <button data-tab="left">☰ Layers</button>
    <button data-tab="right">📊 Analysis</button>
  </div>
  <div id="drawerBackdrop"></div>
  <div id="modal-root"></div>
`;


buildHeader(document.getElementById('hdr')!);
buildLeftPanel(document.getElementById('left')!);
buildRightPanel(document.getElementById('right')!);
buildTimeline(document.getElementById('bottom')!);
buildPipeline(document.getElementById('pipelineStrip')!);
buildFooter(document.getElementById('ftr')!);

/* ---------------- canvas + camera ---------------- */
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let cam: Camera = makeCamera(100, 100, '2d');
state.engine = new OceanEngine();
const eng = state.engine;

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5); // PLAN §10: cap DPR 1.5
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(2, Math.round(r.width * dpr));
  canvas.height = Math.max(2, Math.round(r.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cam.w = r.width; cam.h = r.height;
  clampPan(cam);
}
window.addEventListener('resize', resize);
resize();

// mini-map click → center main view there
const mmInit = getMinimap();
if (mmInit) mmInit.onCenter = (x: number, y: number): void => {
  cam.panX = -x * scale(cam);
  cam.panY = y * scale(cam) * COMPRESSION[cam.mode];
  clampPan(cam);
};

// wheel zoom + drag pan + touch: pinch-zoom & double-tap reset (mobile)
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  zoomAt(cam, e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 0.89);
  clampPan(cam);
}, { passive: false });
let panning = false, lastX = 0, lastY = 0;
// pinch state
const activePtrs = new Map<number, { x: number; y: number }>();
let pinchDist = 0, lastTapT = 0, lastTapX = 0, lastTapY = 0, downX = 0, downY = 0;
canvas.addEventListener('pointerdown', (e) => {
  activePtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePtrs.size === 2) {
    const [a, b] = [...activePtrs.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    panning = false;
    return;
  }
  panning = true; lastX = e.clientX; lastY = e.clientY; downX = e.clientX; downY = e.clientY;
});
window.addEventListener('pointermove', (e) => {
  if (activePtrs.has(e.pointerId)) activePtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePtrs.size === 2 && pinchDist > 0) {
    const [a, b] = [...activePtrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 0) {
      const r = canvas.getBoundingClientRect();
      zoomAt(cam, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / pinchDist);
      clampPan(cam);
      pinchDist = d;
    }
    return;
  }
  if (!panning) return;
  cam.panX += e.clientX - lastX;
  cam.panY += e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  clampPan(cam);
});
window.addEventListener('pointerup', (e) => {
  activePtrs.delete(e.pointerId);
  if (activePtrs.size < 2) pinchDist = 0;
  if (activePtrs.size === 0) {
    panning = false;
    // tap detection (<6px movement, <350ms) → vessel select / double-tap reset
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (moved < 6) {
      const now = performance.now();
      if (now - lastTapT < 350 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 40) {
        cam.zoom = 1; cam.panX = 0; cam.panY = 0; clampPan(cam);
        lastTapT = 0;
      } else {
        lastTapT = now; lastTapX = e.clientX; lastTapY = e.clientY;
        const rect = canvas.getBoundingClientRect();
        selectVesselAt(e.clientX - rect.left, e.clientY - rect.top, ts_now());
      }
    }
  }
});
window.addEventListener('pointercancel', (e) => { activePtrs.delete(e.pointerId); pinchDist = 0; panning = false; });

// ---------------- vessel tap-to-inspect ----------------
const vp = document.createElement('div');
vp.className = 'vessel-pop';
vp.style.display = 'none';
document.getElementById('center')!.appendChild(vp);
let selectedMmsi: number | null = null;
function ts_now(): number { return performance.now(); }

function selectVesselAt(sx: number, sy: number, now: number): void {
  if (!state.layers.vessels) { closeVesselPop(); return; }
  if (caseData) {
    const ranked = rankedVessels();
    let best: { v: (typeof ranked)[0]; d: number; x: number; y: number } | null = null;
    for (const v of ranked) {
      const pos = vesselAtHours(v, state.tHours);
      if (!pos) continue;
      const pr = project(cam, pos.x, pos.y);
      const d = Math.hypot(pr.sx - sx, pr.sy - sy);
      if (d < 28 && (!best || d < best.d)) best = { v, d, x: pos.x, y: pos.y };
    }
    if (!best) { closeVesselPop(); return; }
    const isTop = ranked[0] && best.v.mmsi === ranked[0].mmsi;
    const rows = [
      `<div class="vp-row"><span>Type</span><span>${best.v.type ?? '—'}</span></div>`,
      `<div class="vp-row"><span>MMSI</span><span>${best.v.mmsi ?? '—'}</span></div>`,
      `<div class="vp-row"><span>Score</span><span>${best.v.score ?? '—'}</span></div>`,
      `<div class="vp-row"><span>CPA</span><span>${best.v.cpa_to_origin_km ?? '—'} km</span></div>`
    ];
    vp.innerHTML = `${isTop ? '<div class="vp-suspect">#1 API rank</div>' : ''}<div class="vp-name">${best.v.name ?? ''}</div>${rows.join('')}`;
    const pr = project(cam, best.x, best.y);
    vp.style.display = 'block';
    const popW = vp.offsetWidth, popH = vp.offsetHeight;
    vp.style.left = `${Math.min(Math.max(8, pr.sx + 14), cam.w - popW - 8)}px`;
    vp.style.top = `${Math.min(Math.max(8, pr.sy - popH - 12), cam.h - popH - 8)}px`;
    emit('vesselSelect');
    return;
  }
  closeVesselPop();
}
function closeVesselPop(): void { vp.style.display = 'none'; selectedMmsi = null; }

// ---------------- keyboard shortcuts ----------------
document.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (state.booting) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!state.investigating) { state.playing = !state.playing; emit('playback'); }
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    state.simTime = Math.min(SCRUB_TO, Math.max(SCRUB_FROM, state.simTime + (e.key === 'ArrowRight' ? 900 : -900)));
    emit('seek');
  } else if (e.key === 'r' || e.key === 'R') {
    cam.zoom = 1; cam.panX = 0; cam.panY = 0; clampPan(cam);
  } else if (e.key === '1' || e.key === '2' || e.key === '3') {
    state.cameraMode = e.key === '1' ? '2d' : e.key === '2' ? '2.5d' : '3d';
    emit('camera');
  } else if (e.key === 'i' || e.key === 'I') {
    const runBtn = document.getElementById('runBtn') as HTMLButtonElement | null;
    if (runBtn && !runBtn.disabled) runBtn.click();
  }
});
// sync play button icon with Space key
on('playback', () => {
  const playBtn = document.getElementById('playBtn');
  if (playBtn) { playBtn.textContent = state.playing ? '⏸' : '▶'; playBtn.classList.toggle('playing', state.playing); }
});

// ---------------- mobile drawers ----------------
const mTabs = document.getElementById('mobileTabs')!;
const backdrop = document.getElementById('drawerBackdrop')!;
const leftEl = document.getElementById('left')!;
const rightEl = document.getElementById('right')!;
function closeDrawers(): void {
  leftEl.classList.remove('open'); rightEl.classList.remove('open'); backdrop.classList.remove('show');
  mTabs.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
}
mTabs.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button'); if (!b) return;
  const tab = b.dataset.tab;
  const isOpen = (tab === 'left' ? leftEl : rightEl).classList.contains('open');
  closeDrawers();
  if (!isOpen) {
    (tab === 'left' ? leftEl : rightEl).classList.add('open');
    backdrop.classList.add('show');
    b.classList.add('active');
  }
});
backdrop.addEventListener('click', closeDrawers);

on('camera', () => {
  cam.mode = state.cameraMode;
  document.getElementById('camInfo')!.textContent = `CAM ${state.cameraMode.toUpperCase()} · SEED 20260820`;
});
on('resetView', () => { cam.zoom = 1; cam.panX = 0; cam.panY = 0; });
on('fitGeo', () => { cam.zoom = 0.55; cam.panX = 0; cam.panY = 0; clampPan(cam); });
on('fitScene', () => { cam.zoom = 1; cam.panX = 0; cam.panY = 0; clampPan(cam); });

/* ---------------- pipeline helper ---------------- */
type PState = 'pending' | 'active' | 'done';
const pipelineSet = (i: number, s: PState): void => {
  const el = document.querySelector(`.pstep[data-step="${i}"]`);
  if (!el) return;
  el.classList.remove('active', 'done');
  if (s !== 'pending') el.classList.add(s);
};

/* ---------------- boot sequence (API case, not 36 h Ocean Pride) ---------------- */
const DEFAULT_ENV: CaseEnv = {
  wind: { speed_ms: 6.4, toward_deg: 65 },
  current: { speed_ms: 0.38, toward_deg: 72 }
};

function envForAnalyze(): CaseEnv {
  const form = readEnvForm();
  if (form) return form;
  const e = caseData?.environment;
  return {
    wind: {
      speed_ms: e?.wind?.speed_ms ?? DEFAULT_ENV.wind.speed_ms,
      toward_deg: e?.wind?.toward_deg ?? DEFAULT_ENV.wind.toward_deg
    },
    current: {
      speed_ms: e?.current?.speed_ms ?? DEFAULT_ENV.current.speed_ms,
      toward_deg: e?.current?.toward_deg ?? DEFAULT_ENV.current.toward_deg
    }
  };
}

function enableRunBtn(): void {
  const runBtn = document.getElementById('runBtn') as HTMLButtonElement | null;
  if (!runBtn) return;
  runBtn.disabled = false;
  runBtn.textContent = '▶ Re-run Investigation';
}

let bootTries = 0;
const BOOT_AUTO = 3;

async function bootFromApi(): Promise<void> {
  const msg = document.getElementById('bootMsg')!;
  const bar = document.getElementById('bootBar') as HTMLElement;
  const splash = document.getElementById('bootSplash');
  const retry = document.getElementById('bootRetry') as HTMLButtonElement | null;
  if (splash) splash.classList.remove('hide');
  if (retry) retry.hidden = true;
  msg.textContent = 'Loading case_001…';
  msg.style.whiteSpace = 'pre-wrap';
  bar.style.width = '20%';
  try {
    const data = await fetchCase('case_001');
    applyCase(data);
    bootTries = 0;
    const c = caseCentroid();
    const p = getProjector();
    if (!p) throw new Error('Map projector failed');
    if (c) eng.seedAroundXY(p.lonToX(c.lon), p.latToY(c.lat));
    state.tHours = 0;
    bar.style.width = '100%';
    finishBoot();
    emit('investigation');
    emit('time');
  } catch (err) {
    const text = err instanceof Error ? err.message : API_DOWN;
    bootTries += 1;
    setCaseError(text);
    bar.style.width = '0%';
    if (bootTries < BOOT_AUTO) {
      msg.textContent = text + `\nRetry ${bootTries}/${BOOT_AUTO} in 2s…`;
      window.setTimeout(() => { void bootFromApi(); }, 2000);
    } else {
      msg.textContent = text + '\nStart FastAPI on :8000, then retry.';
      if (retry) {
        retry.hidden = false;
        retry.onclick = () => { bootTries = 0; void bootFromApi(); };
      }
    }
  }
}

function finishBoot(): void {
  if (!getProjector() || !caseData) return;
  state.simTime = T_DET_S;
  state.tHours = hoursRange().min;
  state.booting = false;
  emit('time');
  emit('boot');
  // pipeline steps 1–4 check off with slight stagger (Load case → Leeway)
  const splash = document.getElementById('bootSplash')!;
  splash.classList.add('hide');
  setTimeout(() => pipelineSet(0, 'done'), 250);
  setTimeout(() => pipelineSet(1, 'done'), 700);
  setTimeout(() => pipelineSet(2, 'done'), 1050);
  setTimeout(() => pipelineSet(3, 'done'), 1400);
  state.playing = false;
  const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
  if (playBtn) { playBtn.textContent = '▶'; playBtn.classList.remove('playing'); }
  emit('playback');
}
void bootFromApi();

/* ---------------- seek / investigation wiring ---------------- */
on('caseReplaced', () => {
  const c = caseCentroid();
  const p = getProjector();
  if (c && p) eng.seedAroundXY(p.lonToX(c.lon), p.latToY(c.lat));
  state.tHours = hoursRange().min;
  state.playing = false;
  const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
  if (playBtn) { playBtn.textContent = '▶'; playBtn.classList.remove('playing'); }
});

on('seek', () => {
  if (state.booting) return;
  if (!caseData) eng.restoreAt(state.simTime);
  emit('time');
});

on('playback', () => { /* playing flag consumed in frame() */ });

on('investigate', () => { void runInvestigate(); });

async function runInvestigate(): Promise<void> {
  if (state.investigating) return;
  state.investigating = true;
  state.playing = false;
  emit('playback');
  document.querySelectorAll<HTMLInputElement>('#caseEnvForm input').forEach((el) => { el.disabled = true; });
  pipelineSet(3, 'active');
  pipelineSet(4, 'pending');
  pipelineSet(5, 'pending');
  pipelineSet(6, 'pending');
  pipelineSet(7, 'pending');
  try {
    const id = caseData?.id ?? API_CASE_ID;
    const result = await analyzeCase(id, envForAnalyze());
    applyCase(result);
    pipelineSet(3, 'done');
    pipelineSet(4, 'done');
    pipelineSet(5, 'done');
    pipelineSet(6, 'done');
    pipelineSet(7, 'done');
    state.layers.estSource = true;
    state.layers.uncRegion = false;
    state.layers.backTraj = true;
    state.layers.fwdTraj = true;
    emit('layers');
    emit('investigation');
    emit('investigationDone');
  } catch (err) {
    pipelineSet(3, 'pending');
    const text = err instanceof Error ? err.message : 'analyze failed';
    const runBtn = document.getElementById('runBtn') as HTMLButtonElement | null;
    if (runBtn) runBtn.title = text;
    emit('investigationDone');
  } finally {
    state.investigating = false;
    document.querySelectorAll<HTMLInputElement>('#caseEnvForm input').forEach((el) => { el.disabled = false; });
    enableRunBtn();
    state.playing = false;
    emit('playback');
  }
}

/* ---------------- main loop ---------------- */
const LIVE_SEED = 20260820 ^ 0xc2b2ae35;
let liveU = mulberry32(LIVE_SEED);
let liveG = (() => { let sp: number | null = null; const r = mulberry32(LIVE_SEED ^ 0x77); return (): number => {
  if (sp !== null) { const v = sp; sp = null; return v; }
  let u = 0, v = 0, s = 0;
  do { u = r() * 2 - 1; v = r() * 2 - 1; s = u * u + v * v; } while (s === 0 || s >= 1);
  const f = Math.sqrt((-2 * Math.log(s)) / s); sp = v * f; return u * f;
};})();

let lastTs = performance.now();
let pendingSim = 0;
let lastLabelTs = 0;

function frame(ts: number): void {
  const dtReal = Math.min(0.1, Math.max(0, (ts - lastTs) / 1000)); // clamp hiccups
  lastTs = ts;
  cam.now = ts;

  // --- advance simulation ---
  // 1× leeway: 0.05 forecast-hours per real second (~20 s of wall time per 1 h of drift).
  const LEEWAY_H_PER_S = 0.05;
  if (state.playing && !state.booting && !state.investigating) {
    if (caseData) {
      const { min, max } = hoursRange();
      state.tHours = Math.min(max, state.tHours + dtReal * state.speed * LEEWAY_H_PER_S);
      if (state.tHours >= max - 1e-6) {
        state.playing = false;
        const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
        if (playBtn) { playBtn.textContent = '▶'; playBtn.classList.remove('playing'); }
      }
      emit('time');
    } else {
      pendingSim += dtReal * 12 * state.speed; // toy clock: 1 real s ≈ 12 sim-s (was 60)
      while (pendingSim >= SIM_DT) {
        const tNext = Math.min(SCRUB_TO, state.simTime + SIM_DT);
        if (tNext - state.simTime >= 1) {
          state.simTime = advect(eng.cloud, eng.noise, liveU, liveG, state.simTime, tNext, SIM_DT);
          eng.maybeSnapshot(state.simTime);
        } else { state.simTime = tNext; }
        pendingSim -= SIM_DT;
        if (state.simTime >= SCRUB_TO - 1e-6) {
          state.playing = false;
          const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
          if (playBtn) { playBtn.textContent = '▶'; playBtn.classList.remove('playing'); }
          pendingSim = 0;
          break;
        }
      }
      emit('time');
    }
  }

  // --- render ---
  const slick = eng.slickAt(state.simTime);
  render(ts, slick);

  // --- labels (throttled) ---
  if (ts - lastLabelTs > 250) {
    lastLabelTs = ts;
    updateLabels();
    const mm = getMinimap();
    if (mm) mm.draw(cam, slick);
    leftCamera.w = cam.w; leftCamera.h = cam.h; leftCamera.zoom = cam.zoom; leftCamera.panX = cam.panX; leftCamera.panY = cam.panY; leftCamera.mode = cam.mode; leftCamera.now = cam.now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function render(ts: number, slick: ReturnType<OceanEngine['slickAt']>): void {
  const W = cam.w, H = cam.h;
  ctx.clearRect(0, 0, W, H);
  const L = state.layers;
  drawOcean(ctx, cam, ts);
  if (L.baseMap) drawBaseMap(ctx, cam);
  if (!caseData) {
    if (L.currents) drawCurrents(ctx, cam, eng, state.simTime);
    if (L.wind) drawWind(ctx, cam, eng, state.simTime);
  }
  if (L.weather) drawWeather(ctx, cam, eng, ts);
  if (caseData) {
    // case JSON is the operational truth — skip toy slick / AIS / SAR grain / trajectories
    drawCaseTruth(ctx, cam, L, ts);
  } else {
    if (L.sarOverlay) drawSAR(ctx, cam, slick, ts);
    if (L.oilSpill) drawSpillPolygon(ctx, cam, slick, cam.mode !== '2d');
    if (L.spillBoundary) drawSpillBoundary(ctx, cam, slick);
    const inv = eng.investigation;
    if (inv) {
      drawTrajectories(ctx, cam, inv, state.layers);
      if (L.estSource) drawSourceRings(ctx, cam, inv.estX, inv.estY, ts);
      if (L.uncRegion) drawUncertainty(ctx, cam, inv);
    }
    if (L.vesselTracks) drawVesselTracks(ctx, cam, eng.fleet, state.simTime - 12 * 3600, state.simTime + 2 * 3600);
    if (L.vessels) {
      drawVessels(ctx, cam, eng.fleet, state.simTime, inv ? inv.candidates[0].vessel.def.mmsi : (selectedMmsi ?? null), ts);
      if (inv && inv.candidates[0]) {
        const v = inv.candidates[0].vessel;
        const buf = new Float64Array(2);
        const t0 = Math.max(v.t0, Math.min(state.simTime, v.t1));
        if (posAt(v, t0, buf)) drawSuspectLink(ctx, cam, inv.estX, inv.estY, buf[0], buf[1], ts);
      }
    }
  }
  if (state.showConcentration) drawParticles(ctx, cam, eng, slick, true);
  if (L.particles && !state.showConcentration) drawParticles(ctx, cam, eng, slick, false);
}

let lastRelH = 1e9;
function updateLabels(): void {
  const relH = caseData ? state.tHours : (state.simTime - T_DET_S) / 3600;
  lastRelH = relH;
  const sign = relH >= 0 ? '+' : '−';
  document.getElementById('simInfo')!.textContent = caseData
    ? `leeway ${sign}${Math.abs(relH).toFixed(1)} h from SAR (front = +hours)`
    : `toy clock ${sign}${Math.abs(relH).toFixed(1)} h rel T_det`;
  // bottom-right: computed domain stats from the live slick
  const p = getProjector();
  const c = caseCentroid();
  const area = caseData?.slick?.area_km2;
  if (p && c && typeof area === 'number') {
    document.getElementById('brInfo')!.innerHTML =
      `slick centroid ${c.lat.toFixed(3)}°N ${c.lon.toFixed(3)}°E · case ${area.toFixed(2)} km² · source ${caseData?.slick?.source ?? 'demo'}<br>` +
      `particles = simulation · ranks = API 30/30/20/10/10 · judge Map 5174`;
  } else {
    document.getElementById('brInfo')!.textContent = 'Waiting for case_001 (API :8000)';
  }
  void SCRUB_FROM;
}

// kick the clock label
emit('time');
