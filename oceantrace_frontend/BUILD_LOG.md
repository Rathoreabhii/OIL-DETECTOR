# OCEANTRACE BUILD_LOG.md

Historical builder log (2026-09-07). Current UI/API behavior: `CURRENT_STATE.md`. Rank-1 on 5175 is **ARABIAN HORIZON** from FastAPI, not Ocean Pride from `scoring.ts`.

Builder: oceantrace-builder (subagent), model bai/glm-5.3-flash
Start: 2026-09-07 01:03 IST
Plan: PLAN.md (v2, orchestrator-merged) — implemented EXACTLY per it.
Order: M1 scaffold/shell → M2 engine+tests → M3 canvas wiring → M4 investigation → M5 polish+acceptance.

## Progress
- [x] package.json, tsconfig.json, vite.config.ts, index.html — written
- [ ] npm install (background)
- [ ] styles.css
- [ ] src/ modules…
- [x] styles.css — full glassmorphism shell (header, cards, toggles, scrubber, pipeline chips, modal, footer)
- [ ] M2 engine modules
- [x] src/engine/rng.ts — mulberry32 + seeded gaussian
- [x] src/engine/fields.ts — value noise, wind (8 m/s, 285°±25°/24h), curl-noise currents (ψ=A·vnoise, A=4000), Kh_eff, geo helpers
- [x] src/engine/particles.ts — Euler–Maruyama advect (fwd/bwd), snapshots, NaN guard, centroid
- [x] src/engine/slick.ts — KDE σ=2km/1km grid, 15th-pct threshold, marching squares + chaining, wet-cell area, IoU
- [x] src/engine/vessels.ts — 6-vessel fleet, piecewise-constant-velocity legs, Ocean Pride loiter (0.2 kn, 2.1 h, within 1 km of source)
- [x] src/engine/hindcast.ts — backward hourly blocks, 2σ covariance ellipse, forward validation
- [x] src/engine/scoring.ts — rubric (40/30/20/10/8/5) with per-component value+points, loiter detection, trajectory intersection
- [x] src/engine/engine.ts — orchestrator: boot fwd run w/ 30-min snapshots, resumable investigation state machine, dedicated RNG streams per phase
- [ ] npm install finished EXIT:0 ✓
- [ ] M2 tests (src/test/physics.ts) — next
- [x] src/engine/hindcast.ts, scoring.ts, engine.ts, src/test/physics.ts written
- [x] npx tsc --noEmit → clean

## Errors & fixes (M2)
1. slick.ts: TS union type on contourPolygons fallback + Float64Array→toWorld helper mismatch → inlined world transform, typed fallback. FIXED.
2. physics.ts: forgot eng.beginInvestigation() before step loop. FIXED.
3. **particles.ts sign bug (critical):** backward mode advanced time as `t += dir*h` while `h` was already signed → time ran FORWARD during backward runs (infinite loop, SIGKILL by OOM/timeout) and the backward cloud drifted the wrong way (centroid 85 km off, IoU 0.000). Fix: `h = dir*stepAbs` (signed) + `t += h`. VERIFIED: centroid now 2.39 km from TRUE source.
4. engine.ts: t=0 snapshot missing (72 vs 73) → push canonical t=0 snapshot in constructor. FIXED.
5. scoring.ts: trajectoryIntersection ring-probe loop rewritten cleanly (same semantics).

## Physics test results (npx tsx src/test/physics.ts) — ALL PASS, 8.8 s
- T2 area: observed 2136.0 km² (wet-cell Σ per PLAN); validation 2320 km² (ratio 1.086 ≤ ±25%)
- fwdMatch IoU = 0.817 → conf = 0.832 → "Moderate Confidence" badge band (0.6–0.85)
- T3 backward centroid 2.388 km from TRUE source (≤15 km); ±km = 20.696 km = 2σ semi-major ✓
- estimate 12.0354°N 71.8600°E; slick centroid at T_det 11.9186°N 72.3034°E
- T4 determinism: two full seeded runs → identical JSON ✓
- T5: 73 snapshots × 3000 finite particles ✓
- T6: Ocean Pride #1 total 97 (96±3 ✓, margin 26 over Sagar Shakti 71)
- Current field calibration: mean 13.2 cm/s, p95 0.30, max 0.42 m/s (0.1–0.5 band ✓)

## NOTES (per PLAN §10)
- Window clip: scrubber spans T_det−12h…+24h; the discharge marker (−36h) and
  hindcast hourly points before T_det−12h are still computed (37-pt path) but
  clipped at the scrubber edge (marker clamped to left end with ◂ styling).
- Backward diffusion is time-symmetric in expectation only (documented in
  particles.ts) — backward cloud slightly over-disperses vs true posterior; centroid unbiased.
- Ocean Pride design: loiter (0.2 kn, 2.1 h) ends 1.8 h pre-discharge → closest
  approach t* = −1.8 h; at discharge it is 8.4 km SE at 2.4 kn. Rubric: dist≤15→30,
  tanker→30, <3kn→14, ≤2h→7, traj hit→8, loiter≥2h→5 ⇒ 97.
- [x] src/state.ts — AppState + on/emit pub/sub, 14 layer defs
- [x] src/render/camera.ts — 2D/2.5D/3D projection (k=1/0.62/0.45), zoom+pan, unproject
- [x] src/render/ocean.ts — gradient/horizon/sine highlights/foam/3D clouds
- [x] src/render/overlays.ts — all layers per PLAN §5 draw order
- [x] src/render/minimap.ts — thumbnail + red view bbox + computed coords + scale bar

## M3/M4 — UI modules
- [x] src/ui/header.ts — logo, 6 nav pills (non-active = camera/layer presets, logged), UTC clock, gear popover, NTRO badge
- [x] src/ui/leftPanel.ts — 14 toggles + Reset, 2D/2.5D/3D seg, mini-map card
- [x] src/ui/rightPanel.ts — Incident Summary / Source Reconstruction / Top Candidate / Top-3 bars / Why #1 / CTA — all engine-computed
- [x] src/ui/modal.ts — 6-candidate full rubric table + About/Methodology/Help modals
- [x] src/ui/timeline.ts — scrubber (−12h…+24h, DISCHARGE marker clamped at left edge per window clip), play/pause 1×/2×/4×, computed sim-time readout, particle+concentration toggles, Run Investigation
- [x] src/ui/pipeline.ts — 8 steps, staggered checkoff on boot (1–4), animated during investigation (5–8)
- [x] src/main.ts — skeleton, boot splash, rAF loop (1s=60sim-s, Δt=120s), wheel zoom + drag pan, seek restore, investigation animation, live snapshots beyond T_det

## Build
- npm install EXIT:0 (vite 5.4.21, typescript 5.x, tsx 4.x)
- npm run build EXIT:0 — 24 modules, dist/ 59.5 kB JS (21.3 kB gzip), 18.1 kB CSS
- fixes during UI: overlays.ts stray `hd` var, header emit() arity, main.ts shim imports replaced (mulberry32 direct), modal-root created in skeleton, pipeline wired to #pipelineStrip, slick throttle moved out of playback gate, forecast-range live snapshots appended

## M5 — Final validation (all exit 0)
- `npm run build` → EXIT 0 (tsc --noEmit + vite build, 24 modules, 59.7 kB JS / 21.3 kB gzip, 18.1 kB CSS)
- `npx tsx src/test/physics.ts` → EXIT 0 — ALL 24 CHECKS PASS (8.8 s)
  T2 area/validation ±25% ✓ · T3 centroid 2.39 km ≤ 15 km & ±km=2σ semi-major ✓
  T4 determinism identical JSON ✓ · T5 3000 finite particles ✓ · T6 Ocean Pride #1, 97 ∈ 96±3 ✓
- Headless Chromium smoke (playwright-core, 1600×900): boot → pipeline 1-4 → Run Investigation →
  right panel populated (2136.0 km² · 83.2% · 12.035°N 71.860°E · ±20.7 km · MV Ocean Pride 97/100)
  → modal (7 rows) → layer toggles → 3D/2.5D → concentration → seek → nav preset. ZERO console errors.
- Screenshots in shots/01…07 — visually verified: glassmorphism intact, spill polygon + label,
  source rings, uncertainty ellipse, trajectories, vessel labels, horizon in 3D.
- Cosmetic fix: 2σ label moved below ellipse (was clashing with spill-area label in 3D).

## Nav pill presets (documented per PLAN §6)
Live View → 2D, default layers · SAR Analysis → 2D, SAR+spill only, vessels hidden ·
Vessel Tracking → 2D, vessels+tracks+currents, SAR hidden · Simulation → 2.5D, particles+wind+currents ·
Analytics → 2D, spill+source+uncertainty, vessels hidden · Reports → 3D, minimal layers.
Active pill state switches; each click logs `[OCEANTRACE] nav preset → <name>` to console.

## Final file inventory (all per PLAN §2)
index.html · package.json · tsconfig.json · vite.config.ts · styles.css
src/main.ts · src/state.ts
src/engine/{rng,fields,particles,slick,hindcast,vessels,scoring,engine}.ts
src/render/{camera,ocean,overlays,minimap}.ts
src/ui/{header,leftPanel,rightPanel,modal,timeline,pipeline,footer}.ts
src/test/physics.ts  (+ smoke.mjs dev-only headless check, shots/)
STATUS: BUILD ✓ TESTS ✓ SMOKE ✓ → DONE marker written.
