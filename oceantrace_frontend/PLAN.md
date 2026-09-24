# OCEANTRACE — Build Plan (v2, orchestrator-merged)

> **Honesty overlay (shipped 5175):** This plan’s “All Systems Online / NTRO Secure Mode / Ocean Pride scoring.ts rubric” is **not** what the live UI claims. Live: FastAPI `case_001` (ARABIAN HORIZON, 30/30/20/10/10), particles are local toys, leeway 0°=N, no fake LIVE. See `CURRENT_STATE.md`. Keep this file as the original build spec.

> Written directly by orchestrator after two planner-agent LLM timeouts. Planner + critique merged.
> Builder must implement EXACTLY this. Model for all agents: bai/glm-5.3-flash only.

## 1. Overview & Stack
- Frontend-only maritime oil-spill attribution dashboard, desktop 1440px+.
- **Vite + TypeScript, ZERO runtime dependencies.** Canvas 2D rendering, hand-written CSS (glassmorphism dark navy).
- Fully offline, deterministic (seeded RNG). No backend, no network calls.
- Dev deps allowed: `typescript`, `vite`, `tsx` (for physics tests).

## 2. File Tree
```
oceantrace/
  index.html
  package.json  tsconfig.json  vite.config.ts  styles.css
  src/main.ts            — bootstrap, game loop (requestAnimationFrame), wiring
  src/state.ts           — AppState + pub/sub emitter
  src/engine/rng.ts      — mulberry32 seeded RNG + gaussian()
  src/engine/fields.ts   — wind + current fields (deterministic noise)
  src/engine/particles.ts— particle cloud, forward/backward advection
  src/engine/slick.ts    — KDE, contour polygon, area
  src/engine/hindcast.ts — backward run → source estimate + uncertainty ellipse
  src/engine/vessels.ts  — synthetic AIS vessels (kinematics, loiter)
  src/engine/scoring.ts  — candidate scoring rubric
  src/engine/engine.ts   — orchestrates stages (pipeline steps 1-8)
  src/render/camera.ts   — geo↔screen projection for 2D/2.5D/3D
  src/render/ocean.ts    — ocean background (gradient, waves, horizon)
  src/render/overlays.ts — all map overlay layers (draw order below)
  src/render/minimap.ts  — mini-map card
  src/ui/header.ts leftPanel.ts rightPanel.ts timeline.ts pipeline.ts footer.ts
  src/test/physics.ts    — acceptance tests (run via npx tsx)
```

## 3. Scenario Constants
- Domain: lon [70.5, 73.5]°E, lat [11.5, 13.5]°N (Indian Ocean). 1°lat=111.32 km; 1°lon=111.32·cos(12°) km.
- **T_det** = 2026-08-20 14:30 UTC (detection). **T_src_true** = 2026-08-19 02:30 UTC (36 h before).
- TRUE source (test/validation only): 12.014°N, 71.862°E. Vessel start positions defined relative to it. Displayed estimates MUST come from the engine, never from this constant.
- Seed: 20260820. Sim tick: 1 real second (at 1×) = 60 sim-seconds; physics dt = 60 s per tick.

## 4. Physics Engine (exact spec)
### Fields (deterministic, seeded value-noise)
- Wind: `u_wind(x,y,t) = W0 · dir(θw(t)) · (1 + 0.3·vnoise(x/50km, y/50km, t/6h))`, W0 = 8 m/s, θw drifts sinusoidally ±25° over 24 h (base 285°).
- Currents: divergence-free curl noise: `ψ = A·vnoise(x/30km, y/30km, t/12h)`, `u_cur = (∂ψ/∂y, −∂ψ/∂x)·S`, A such that |u_cur| ∈ 0.1–0.5 m/s.
- Windage = 0.03·u_wind. Stokes drift = 0.02·u_wind.

### Particles (Euler–Maruyama)
- N = 3000. State: (x, y) meters. Release: at T_src_true, disc r0 = 200 m (uniform disc).
- Update per dt: `x += (u_cur + 0.03·u_wind + 0.02·u_wind)·dt + sqrt(2·Kh_eff·dt)·g`, g~N(0,1) per axis, `Kh_eff = 5 + 0.002·t` m²/s (Fay-informed growth).
- **Backward mode:** evaluate fields at (x, y, t−τ) stepping τ negative; diffusion uses `sqrt(2·Kh_eff·|dt|)` (time-symmetric in expectation — document this).
- Particle count constant; reject/replace any NaN.

### Slick geometry
- KDE: Gaussian kernel σ=2 km on 1 km grid over active particles (weight=1) → density field.
- Polygon: threshold at 15th percentile of wet cells → boundary contour (marching squares; fallback: cell-boundary tracing).
- Area = Σ wet cells × 1 km² → "Detected Oil Spill X.X km²". Detection confidence: `conf = clamp(0.5 + 0.35·fwdMatch + 0.15·(1 − unc/30km), 0, 0.99)`.

### Hindcast → Source estimate (Run Investigation)
1. Backward advect detection-state particles T_det → T_src (36 h, 1 h steps).
2. Source estimate = centroid of backward particles at T_src; **uncertainty ellipse** = 2σ covariance (a,b,θ) displayed as "±X km".
3. Forward validation: re-release at estimate, run to T_det, fwdMatch = area intersection/union vs observed.
4. Scoring (below) against vessels at T_src window.

### AIS vessels & scoring
- 6 vessels: MV Ocean Pride (Oil Tanker, MMSI 563214000 — loiters 0.2 kn for 2.1 h within 1 km of true source in window), MV Eastern Trader (Cargo), MV Atlas Voyager (Cargo), MV Sagar Shakti (Chemical Tanker, mid distance), MV Neptune Glory (Bulk Carrier, far), MV Coastal Star (Cargo, transiting).
- Kinematics: piecewise constant velocity + explicit loiter segment (Ocean Pride). Track polyline stored for display.
- Rubric (Σ=100): distance to estimated source (≤5 km:40, ≤15:30, ≤30:18, else 8) · type (Oil/Chemical tanker:30, Bulk:18, Cargo:12) · speed anomaly at discharge (<0.5 kn:20, <3 kn:14, else 5) · time proximity (≤30 min:10, ≤2 h:7, ≤6 h:4, else 1) · trajectory intersection with backward cloud (hit:8, near:5, no:0) · loitering (≥2 h:5, ≥1 h:3, >0:1).
- "Why #1?" table shows each computed component value + its points; Total = Σ.

## 5. Rendering (draw order)
base ocean (vertical gradient, horizon ~18% top, animated sine wave highlights, foam specks) → current arrows (sparse grid, cyan) → wind arrows (sparse, white) → SAR overlay (grainy noise texture, dark blobs) → spill polygon (red translucent fill + #ff3366 contour) → spill boundary (dashed) → backward/forward trajectory polylines (white/orange) → source rings (cyan concentric + crosshair) → vessel tracks (thin grey) → vessels (rotated ship glyph + label box: name/class/speed) → particles (2 px, red-orange alpha by local density when toggled) → uncertainty ellipse (cyan dashed) → suspect link (yellow dashed, animated dash offset).
- Camera: 2D = orthographic top-down; 2.5D = y-axis compression 0.62 + horizon fade; 3D = 0.45 compression + wave parallax + cloud layer. One `project(lat,lon)` function per mode; overlays unchanged.
- Timeline scrubber −12 h…+24 h rel. T_det with discharge (blue) & detection (red) markers; hindcast points before T_det−12 h still computed (window clip note in BUILD_LOG).

## 6. UI Spec (every element, computed values only)
- **Header:** logo mark + OCEANTRACE + tagline "Satellite Oil Spill Attribution System | DETECT · ANALYZE · TRACE · PROTECT"; nav pills Live View (active) / SAR Analysis / Vessel Tracking / Simulation / Analytics / Reports (non-active pills switch center overlay presets — minimal: set camera/layer presets, log in BUILD_LOG); "● All Systems Online" (pulsing green), live UTC clock, gear icon, "NTRO Secure Mode" badge.
- **Left panel:** Map Layers card — 14 working toggles (Satellite Base Map, SAR Image Overlay, Detected Oil Spill, Spill Boundary, Estimated Source, Uncertainty Region, Backward Trajectory, Forward Trajectory, Vessels (All), Vessel Tracks, Ocean Currents, Wind Layer, Particles (Simulation), Weather (Forecast)) + Reset; View Mode segmented 2D/2.5D/3D; mini-map card (thumbnail of domain, red bbox of view, coords "12.436° N, 72.118° E | Indian Ocean", scale 0/50/100 km).
- **Right panel (all computed):** Incident Summary (area km², confidence, T_det, "Moderate Confidence" badge if conf 0.6–0.85 else High/Low) · Source Reconstruction (est. lat/lon from hindcast, ±km from ellipse semi-major, discharge time) · Top Candidate (name/type/MMSI/photo placeholder, score /100 glowing) · Top 3 list (ranked, animated score bars) · Why #1? breakdown table (component, value, +pts) · "View Detailed Analysis →" (opens modal w/ full table of all 6 candidates) · CTA "View Detailed Analysis".
- **Bottom:** play/pause + 1×/2×/4×, scrubber with markers + current sim time "Aug 20, 2026 14:30:00 UTC (0h)", Show Particles + Oil Concentration (gradient legend) toggles, 8-step pipeline strip (Ingest SAR → Detect Spill → Estimate Geometry → Backtrack Drift → Estimate Source → Search AIS → Score Candidates → Generate Report) with green checkmarks as engine completes stages, "▶ Run Investigation" button (runs full hindcast+forward+scoring with animated progress).
- **Footer:** OCEANTRACE v2.0.0 · National Technical Research Organisation (NTRO) | SIH 2026 · "Cleaner Oceans. Safer Tomorrows." · About/Methodology/Help links.
- Boot flow: engine runs to T_det state (forward from release) on load; pipeline steps 1–4 check off with slight stagger; Run Investigation populates right panel.

## 7. State
Single AppState: { simTime, playing, speed, cameraMode, layers:Record<name,bool>, toggles, engine, investigation, results }. Tiny emitter `on/emit`; UI modules subscribe; single rAF loop advances sim + renders + updates dynamic labels.

## 8. Milestones (builder order)
M1 scaffold + full static app shell (all panels, exact look) → M2 engine modules + physics tests passing → M3 engine→canvas wiring + timeline + pipeline → M4 Run Investigation + right panel computed values + modal → M5 layer toggles/camera modes/minimap/labels polish + acceptance pass + build clean.

## 9. Acceptance Tests (src/test/physics.ts, `npx tsx`)
1. `npm run build` exit 0.
2. Forward from TRUE source: area(T_det) within ±25% of observed area.
3. Backward centroid within 15 km of TRUE source; displayed ±km = semi-major of 2σ ellipse.
4. Determinism: seed run twice → identical JSON (centroid, area, scores).
5. No NaN particle positions; count === 3000 always.
6. Scoring: Ocean Pride ranks #1 and totals 96±3 with the rubric.

## 10. Risks
- GLM endpoint timeouts (seen twice tonight) → builder writes files incrementally, logs to BUILD_LOG.md after every file; resume instructions there.
- Canvas perf @3000 particles → 2px rects, no shadows, cap DPR at 1.5.
- Marching squares edge cases → cell-boundary polygon fallback.
- 36 h hindcast vs −12 h scrubber → window clip documented (allowed).
