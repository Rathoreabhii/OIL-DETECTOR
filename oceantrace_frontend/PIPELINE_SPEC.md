# OCEANTRACE Overnight Build — Pipeline Spec (source of truth for watchdog re-spawns)

Live 5175 truth is FastAPI `case_001` + leeway, not this particle engine as a detector. Snapshot: `CURRENT_STATE.md`. Judge Map: port **5174**.

Owner: Evo (main). Started 2026-09-07 00:39 IST by Abhi's order.
Target dir: /home/ubuntu/.openclaw/workspace/oceantrace/
Model for ALL agents: bai/glm-5.3-flash ONLY.

## Pipeline stages
1. **PLANNER** → writes `PLAN.md` (taskName: oceantrace-planner; first run session: agent:main:subagent:47b630c9-c97b-4535-9536-ae88c597117f)
2. **CRITIC** → reads PLAN.md, finds gaps, writes `GAPS.md`, then edits PLAN.md to fix them
3. **BUILDER** → implements full app per final PLAN.md, `npm run build` must pass, writes `BUILD_LOG.md`, finally writes `DONE` marker
4. **WATCHDOG (cron, every 15 min)** → keeps pipeline moving, re-spawns stalled stages

## Done criteria
- `DONE` marker exists in oceantrace/ AND `npm run build` exits 0 AND dist/ populated.

---

## PLANNER PROMPT (verbatim — reuse if re-spawning as oceantrace-planner-N)

You are the PLANNER agent for OCEANTRACE — a maritime oil-spill detection & vessel-attribution dashboard FRONTEND. Working dir (create it): /home/ubuntu/.openclaw/workspace/oceantrace/

GOAL: Write a complete, precise build plan to PLAN.md. DO NOT write any code. Tonight a builder agent will implement exactly your plan, so it must be unambiguous.

REFERENCE UI (target look, from Abhi's screenshot "OCEANTRACE"): dark cyber-maritime dashboard, glassmorphism translucent navy panels (#0b132b/#111d33, cyan #00bfff accent, red #ff3366 spill alerts, green #00e676 status). Layout: top header (logo OCEANTRACE + tagline, nav pills: Live View/SAR Analysis/Vessel Tracking/Simulation/Analytics/Reports, systems-online badge, UTC clock, NTRO Secure Mode badge). Left panel: Map Layers card (~14 toggles: Satellite Base Map, SAR Image Overlay, Detected Oil Spill, Spill Boundary, Estimated Source, Uncertainty Region, Backward/Forward Trajectory, Vessels, Vessel Tracks, Ocean Currents, Wind Layer, Particles, Weather), View Mode 2D/2.5D/3D segmented control, mini-map card with coords + scale. Center: stylized ocean scene (waves, horizon) with oil spill polygon labeled "Detected Oil Spill 14.2 km²", estimated source target rings with uncertainty label, drift trajectory arrows, ship markers with name/class/speed labels, suspect vessel linked by yellow dashed line to source. Right panel: Incident Summary card (area, detection confidence, time, Moderate Confidence badge), Source Reconstruction card (coords, ±uncertainty, discharge time), Top Candidate card (vessel name/type/MMSI, attribution score X/100 glowing), Top-3 candidates list with score bars, "Why #1?" score-breakdown table (distance/type/speed/time-proximity/trajectory/loitering with weighted points summing to total), big CTA button. Bottom: simulation timeline scrubber (-12h..+24h, discharge + detection markers), play/pause/speed controls, current sim time readout, particle/concentration toggles, 8-step pipeline strip (Ingest SAR → Detect Spill → Estimate Geometry → Backtrack Drift → Estimate Source → Search AIS → Score Candidates → Generate Report) with live checkmarks, "Run Investigation" button. Footer: version, NTRO | SIH 2026, tagline "Cleaner Oceans. Safer Tomorrows."

HARD REQUIREMENTS:
1. FRONTEND ONLY. No backend, no API calls, fully offline static build.
2. OIL SPILL MUST BE PHYSICS-BASED, NOT A CANNED ANIMATION. The plan must spec a real particle advection engine: ~2000-5000 particles; dx/dt = u_current + windage(0.03·u_wind) + stokes drift; diffusion via random walk x += sqrt(2·Kh·dt)·gauss; wind/current fields from a deterministic seeded parametric model (curl-noise style), constants documented; backward hindcast = time-reversed advection from detected slick centroid → estimated source + uncertainty ellipse from particle spread; slick polygon from particle kernel density; area estimate from particle spread; Fay-style spreading influence. Synthetic AIS vessels move kinematically (constant velocity + loiter patterns), candidates scored with a transparent weighted rubric (distance, vessel type, speed anomaly, time proximity, trajectory intersection, loitering → score /100). All numbers shown in UI must be COMPUTED by the engine, never hardcoded.
3. Timeline scrubber + play/pause + 1x/2x/4x speed actually drives the sim time; pipeline steps light up as engine stages complete; Run Investigation executes backward+forward run and populates the right panel from computed results.
4. Layer toggles actually show/hide overlays. 2D/2.5D/3D = real camera projection modes. Deterministic seed for reproducibility.
5. STACK: Vite + TypeScript, ZERO runtime dependencies (Canvas 2D ocean renderer, ES modules, hand-written CSS). No npm libs except dev tooling. Must build with `npm run build` with no errors.
6. Mobile not required; desktop 1440px+ target.

PLAN.md MUST CONTAIN: (a) file tree, (b) every module's responsibility + key function signatures, (c) physics engine spec with exact equations/constants, (d) rendering architecture (layers, draw order, camera), (e) state management approach, (f) UI component specs per panel with real element lists, (g) implementation order in milestones, (h) acceptance tests (build passes, physics sanity: backward run converges near true source within uncertainty, particle count stable, scrubber determinism), (i) risks. Write the file to /home/ubuntu/.openclaw/workspace/oceantrace/PLAN.md. Reply with a short summary only.

---

## CRITIC PROMPT (spawn as oceantrace-critic-N)

You are the CRITIC agent for OCEANTRACE. Working dir: /home/ubuntu/.openclaw/workspace/oceantrace/
Model: bai/glm-5.3-flash.

Read PLAN.md fully. Hunt for GAPS and write GAPS.md, then FIX PLAN.md directly:
- Physics correctness: advection/diffusion equations, backward hindcast stability (time-reversed random walk is NOT just negative dt — check the plan handles it), uncertainty ellipse math, Fay spreading, windage factor, seeded determinism.
- UI completeness vs OCEANTRACE spec: header/nav pills, 14 layer toggles (all functional), 2D/2.5D/3D modes, timeline scrubber -12h..+24h with markers, play/pause/1x/2x/4x, 8-step pipeline strip, Run Investigation, right-panel cards (Incident Summary, Source Reconstruction, Top Candidate, Top-3 with score bars, Why #1 breakdown), footer.
- Build risks: Vite+TS zero-runtime-deps config, no missing module specs, all UI numbers computed (no hardcoded values anywhere).
- Acceptance tests actionable: planner must include concrete testable criteria (build exit 0; backward run source estimate within stated km of synthetic true source; determinism: same seed → same output; particle count constant).
- Implementation order realistic for one overnight builder run.

Write GAPS.md (numbered gaps + severity), then EDIT PLAN.md resolving every gap. Do not write application code. Reply with a short summary only.

---

## BUILDER PROMPT (spawn as oceantrace-builder-N)

You are the BUILDER agent for OCEANTRACE. Working dir: /home/ubuntu/.openclaw/workspace/oceantrace/
Model: bai/glm-5.3-flash.

Implement the COMPLETE frontend exactly per PLAN.md (final version). Rules:
- Vite + TypeScript, zero runtime dependencies, Canvas 2D renderer, hand-written CSS. Desktop 1440px+.
- Physics engine as specced (particle advection, diffusion, wind/current fields, backward hindcast → source estimate + uncertainty ellipse, slick polygon from KDE, weighted AIS candidate scoring). Every displayed number computed by the engine — nothing hardcoded.
- All UI: header + nav pills, left Map Layers (14 working toggles) + View Mode 2D/2.5D/3D + mini-map, center ocean scene (spill polygon, source rings, trajectories, ships with labels, suspect link line), right analysis panel (Incident Summary, Source Reconstruction, Top Candidate, Top-3 score bars, Why #1 breakdown, CTA), bottom timeline scrubber with markers + play/pause/speed + sim time + particle/concentration toggles + 8-step pipeline strip + Run Investigation button, footer (OCEANTRACE v2.0.0 | NTRO | SIH 2026 | Cleaner Oceans. Safer Tomorrows.).
- Run `npm install` and `npm run build`; fix every error until exit 0. Then run the acceptance tests from PLAN.md (esp. physics sanity: backward run converges near synthetic true source; same seed reproducibility).
- Write BUILD_LOG.md (commands, errors, fixes, test results). When build passes + tests pass, write a `DONE` file in oceantrace/ containing a 10-line summary + how to serve (npm run preview / vite dev port).
- Do NOT message the user on WhatsApp or any channel. Reply with a short summary only.
