# Graph Report - oil detector  (2026-09-14)

## Corpus Check
- 118 files · ~1,045,931 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1345 nodes · 2801 edges · 77 communities (67 shown, 10 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 74 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2f99cb92`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- score.py
- sea.js
- train.py
- frontend/src/main.js
- src/main.js
- HeightField
- detect.py
- drift.py
- main.py
- panel.js
- frontend/package.json
- map.js
- package.json
- shrink_and_tile.py
- preprocessing.py
- upload.js
- pipeline_config.py
- investigate.py
- Demo SAR-like preview
- main.ts
- U-Net retrained on TIFF index 1 (DIMAP Sigma0_VV_db)
- Unused dutch-ship PBR pack
- ais.py
- manifest.py
- Map Run investigation does not re-detect SAR
- __init__.py
- SIH hardware 16 GB RAM 8 GB VRAM
- Upload investigate tries U-Net then dark-spot fallback
- advise/model.py
- overlays.ts
- Judge desk HTML
- hull.glb not a tanker
- rightPanel.ts
- test_predict_stitch.py
- caseView.ts
- AI Handoff Brief: Improving SAR Oil-Spill Segmentation Recall Safely
- calibrate.py
- camera.ts
- config.py
- engine.ts
- OceanEngine
- compilerOptions
- 3. Deep-Dive Code Verification
- oceantrace_frontend/package.json
- vessels.ts
- OCEANTRACE — Build Plan (v2, orchestrator-merged)
- fields.ts
- get_dataloaders
- honesty_check.py
- environment.js
- physics.ts
- scoring.ts
- 2. File-by-File Technical Root Causes
- Ocean.js
- loadCase
- OCEANTRACE BUILD_LOG.md
- FFT.js
- tiles.ts
- FFT
- OceanTrace — current state (2026-09-13)
- 2. Full Milestone Chronology
- OCEANTRACE Overnight Build — Pipeline Spec (source of truth for watchdog re-spawns)
- After the hackathon PPT — leftover-data retrain
- Session summary — inference hardening + honesty checks
- get_trained_model
- Honesty check
- CaseProjector
- Maritime environment (port 5173 — frozen)
- honesty-verifier.md
- Third-party notices
- OceanTrace (SIH 26143)
- _ConstModel
- work-watchdog.md
- vite.config.ts
- honesty.md

## God Nodes (most connected - your core abstractions)
1. `score_vessel()` - 28 edges
2. `ConfigError` - 26 edges
3. `OceanEngine` - 26 edges
4. `project()` - 24 edges
5. `ManifestError` - 22 edges
6. `getProjector()` - 20 edges
7. `drawCaseTruth()` - 20 edges
8. `detect_slick()` - 19 edges
9. `render()` - 19 edges
10. `AI Handoff Brief: Improving SAR Oil-Spill Segmentation Recall Safely` - 19 edges

## Surprising Connections (you probably didn't know these)
- `Laptop caps 16 GB RAM + RTX 4060 8 GB VRAM` --semantically_similar_to--> `SIH hardware 16 GB RAM 8 GB VRAM`  [INFERRED] [semantically similar]
  STATUS.md → SIH.md
- `U-Net retrained on TIFF index 1 (DIMAP Sigma0_VV_db)` --conceptually_related_to--> `U-Net overlay big slick tile 01210_t003`  [INFERRED]
  STATUS.md → data/demo/unet_preview/big_slick.png
- `U-Net retrained on TIFF index 1 (DIMAP Sigma0_VV_db)` --conceptually_related_to--> `U-Net overlay faint slick 00970_t010`  [INFERRED]
  STATUS.md → data/demo/unet_preview/faint_slick.png
- `Map Run investigation does not re-detect SAR` --semantically_similar_to--> `SIH: U-Net val Dice 0.881 not used on Map analyze`  [INFERRED] [semantically similar]
  STATUS.md → SIH.md
- `Upload investigate tries U-Net then dark-spot fallback` --conceptually_related_to--> `U-Net overlay canned sar_preview thin dark line`  [INFERRED]
  STATUS.md → data/demo/unet_preview/demo_preview.png

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Phase B index-1 U-Net retrain and honest metrics** — status_unet_index1_retrain, status_val_metrics_0881, status_hardware_caps, sih_unet_val_0881 [INFERRED 0.85]
- **Unused historic sailing PBR** — 3dmodels_textures_dutch_ship_pbr, 3dmodels_textures_hull_diffuse, 3dmodels_textures_sails_diffuse, 3dmodels_textures_rigging_diffuse [INFERRED 0.85]

## Communities (77 total, 10 thin omitted)

### Community 0 - "score.py"
Cohesion: 0.10
Nodes (40): _ais_gap_score(), _ais_points(), _angle_delta_deg(), _as_float(), _clamp01(), _closest_approach(), _first(), _fmt_hours() (+32 more)

### Community 1 - "sea.js"
Cohesion: 0.07
Nodes (42): setTab(), TAB_ORDER, createMap(), createSea3d(), normalizeRoot(), TYPE_SCALE, blobPath(), createSea() (+34 more)

### Community 2 - "train.py"
Cohesion: 0.12
Nodes (18): build_model(), calculate_metrics(), CombinedDiceBCELoss, Module, Tensor, U-Net Model Architecture & Combined Loss for SAR Oil Spill Detection., Tversky Loss (recall-boosted) + Focal BCE for SAR oil spill segmentation. alpha…, Pure PyTorch fallback U-Net (in case pretrained library weights are… (+10 more)

### Community 3 - "frontend/src/main.js"
Cohesion: 0.09
Nodes (30): analyzeBtn, analyzeForm, analyzeStatus, app, banner, bindHourSlider(), boot(), caseLabel() (+22 more)

### Community 4 - "src/main.js"
Cohesion: 0.18
Nodes (8): clampCamera(), createCamera(), DEFAULT_VIEW, createGui(), canvas, errorBox, loader, Atmosphere

### Community 5 - "HeightField"
Cohesion: 0.14
Nodes (4): HeightField, createFloatRenderTarget(), FullscreenPass, makeComputeMaterial()

### Community 6 - "detect.py"
Cohesion: 0.10
Nodes (41): array, _blob_polygon(), _circle_rc(), _clamp01(), _confidence(), _decode_image(), _decode_pil(), _decode_png() (+33 more)

### Community 7 - "drift.py"
Cohesion: 0.09
Nodes (25): _as_float(), _east_north_ms(), forecast(), hindcast(), _iso_z(), leeway_velocity_ms(), origin_window_iso(), _parse_iso() (+17 more)

### Community 8 - "main.py"
Cohesion: 0.19
Nodes (22): analyze_case(), _case_path(), get_case(), health(), investigate_upload(), list_cases(), _ll_dict(), _load_case() (+14 more)

### Community 9 - "panel.js"
Cohesion: 0.26
Nodes (20): compass(), dash(), dlRow(), envBlock(), escapeHtml(), fmtConfidence(), fmtDeg(), fmtNum() (+12 more)

### Community 10 - "frontend/package.json"
Cohesion: 0.11
Nodes (17): dependencies, leaflet, three, description, devDependencies, vite, three, vite (+9 more)

### Community 11 - "map.js"
Cohesion: 0.18
Nodes (12): asLatLon(), deadReckon(), leewayEN(), shiftLatLon(), shiftPolygon(), stepLatLon(), trackPoints(), vesselAtTime() (+4 more)

### Community 12 - "package.json"
Cohesion: 0.11
Nodes (17): lil-gui, dependencies, lil-gui, three, description, devDependencies, vite, three (+9 more)

### Community 13 - "shrink_and_tile.py"
Cohesion: 0.21
Nodes (13): extract_7z_archives(), load_image(), load_mask(), process_dataset(), ndarray, Path, Dataset Shrinking and Tiling Script for Sentinel-1 SAR Oil Spill Data. This…, Main shrinkage and tiling routine. (+5 more)

### Community 14 - "preprocessing.py"
Cohesion: 0.07
Nodes (57): get_dataloaders(), _manifest_entries(), OilSpillDataset, Any, ndarray, Path, Tensor, Manifest-driven datasets and reproducible loaders for oil-spill segmentation.… (+49 more)

### Community 15 - "upload.js"
Cohesion: 0.38
Nodes (9): bindUpload(), buildInvestigateFormData(), detailFromBody(), FORM_FIELDS, formatHttpError(), looksLikeCase(), looksLikeRgbPhoto(), unwrapCase() (+1 more)

### Community 16 - "pipeline_config.py"
Cohesion: 0.10
Nodes (41): _bool(), CalibrationMetadata, ComponentFilterConfig, ConfigError, _enum(), _float(), InferenceConfig, _int() (+33 more)

### Community 17 - "investigate.py"
Cohesion: 0.43
Nodes (6): _as_latlon(), investigate(), Any, Detect → drift → score case builder. Not operational, not a live feed., Build a case dict: detect_slick → leeway drift → rank_vessels. Raises if…, _region()

### Community 18 - "Demo SAR-like preview"
Cohesion: 0.43
Nodes (7): Case 001 demo overlay, Dark elongated slick, Not live Sentinel-1 GRD, Not NTRO operational imagery, Demo SAR-like preview, SAR speckle, Sea surface

### Community 19 - "main.ts"
Cohesion: 0.07
Nodes (44): setCaseError(), activePtrs, bootFromApi(), cam, canvas, closeVesselPop(), DEFAULT_ENV, enableRunBtn() (+36 more)

### Community 20 - "U-Net retrained on TIFF index 1 (DIMAP Sigma0_VV_db)"
Cohesion: 0.40
Nodes (5): U-Net overlay big slick tile 01210_t003, U-Net overlay faint slick 00970_t010, Old index-0 checkpoint Dice 0.307 recall 0.323, U-Net retrained on TIFF index 1 (DIMAP Sigma0_VV_db), Independent val Dice 0.881 recall 0.902 precision 0.861

### Community 21 - "Unused dutch-ship PBR pack"
Cohesion: 0.50
Nodes (4): Unused dutch-ship PBR pack, Hull diffuse map, Rigging diffuse map, Sails diffuse map

### Community 22 - "ais.py"
Cohesion: 0.50
Nodes (3): parse_ais_csv(), Any, Parse demo AIS CSV. Stdlib only.

### Community 23 - "manifest.py"
Cohesion: 0.10
Nodes (40): canonical_manifest_sha256(), load_manifest(), Manifest, manifest_file_sha256(), ManifestError, pair_image_mask_paths(), parse_legacy_scene_id(), _path_text() (+32 more)

### Community 24 - "Map Run investigation does not re-detect SAR"
Cohesion: 0.67
Nodes (3): Judge map on port 5174 not frozen 5173, SIH: U-Net val Dice 0.881 not used on Map analyze, Map Run investigation does not re-detect SAR

### Community 28 - "advise/model.py"
Cohesion: 0.09
Nodes (30): ArchitectureConfig, build_loss(), build_model(), calculate_metrics(), calculate_recall_precision(), capped_lovasz_per_image(), _checkpoint_architecture(), CombinedDiceBCELoss (+22 more)

### Community 29 - "overlays.ts"
Cohesion: 0.12
Nodes (41): pathXY(), sarImage(), trackXY(), headingAt(), posAt(), sampleTrack(), speedAtKn(), render() (+33 more)

### Community 33 - "rightPanel.ts"
Cohesion: 0.13
Nodes (30): analyzeCase(), CaseEnv, CaseJson, CaseVessel, fetchCase(), investigateUpload(), LL, unwrap() (+22 more)

### Community 35 - "test_predict_stitch.py"
Cohesion: 0.12
Nodes (31): apply_hysteresis(), _as_prob_map(), axis_tile_starts(), gaussian_tile_weight(), mask_to_latlon_polygon(), _morphological_close(), pad_for_tiles(), predict_mask() (+23 more)

### Community 36 - "caseView.ts"
Cohesion: 0.15
Nodes (27): centroidOf(), originOf(), applyCase(), asBounds(), caseCentroid(), caseOrigin(), dischargeHours(), hoursRange() (+19 more)

### Community 37 - "AI Handoff Brief: Improving SAR Oil-Spill Segmentation Recall Safely"
Cohesion: 0.07
Nodes (28): 10. Recovering thin and faint slicks, 11. Postprocessing requirements, 12. Calibration objective, 13. Part III evaluation protocol, 14. Metrics that must be reported, 15. Required automated tests, 16. Honest expectations, 17. Instructions to the receiving AI (+20 more)

### Community 38 - "calibrate.py"
Cohesion: 0.17
Nodes (21): _first_existing(), list_val_scenes(), look_stem(), main(), _metrics(), noil_stem(), oil_stem(), Path (+13 more)

### Community 39 - "camera.ts"
Cohesion: 0.23
Nodes (17): active, getDomainM(), getProjector(), baseScale(), Camera, CameraMode, clampPan(), COMPRESSION (+9 more)

### Community 40 - "config.py"
Cohesion: 0.17
Nodes (17): Configuration for SAR Oil Spill U-Net Training & Preprocessing., main(), pair(), Path, Score frozen oil_unet.pt on Zenodo Part III. TEST ONLY. Do not train on these…, score_split(), main(), _oil_positive_count() (+9 more)

### Community 41 - "engine.ts"
Cohesion: 0.21
Nodes (18): clamp(), detCloudOf(), DOMAIN, Investigation, InvPhase, InvState, yToLat(), BackwardRunState (+10 more)

### Community 42 - "OceanEngine"
Cohesion: 0.14
Nodes (10): OceanEngine, restoreFromSnaps(), Snapshot, takeSnapshot(), computeKDE(), contourPolygons(), GRID, Slick (+2 more)

### Community 43 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, noUnusedLocals (+12 more)

### Community 44 - "3. Deep-Dive Code Verification"
Cohesion: 0.10
Nodes (19): 1. Executive Summary, 2. Comprehensive Gap Verification Matrix, 3.1. Section 1A: Scene-Level Data Leakage Fix (`backend/ml/dataset.py`), 3.2. Section 1B: Dual-Polarisation Input vs. Real Repo Constraints, 3.3. Section 1C: Focal + Dice Loss (`backend/ml/model.py` & `train.py`), 3.4. Section 1D: Sliding Window Inconsistency (`backend/ml/predict.py`), 3.5. Section 1E: Polygon Extraction — Multi-Component + Real Contours, 3.6. Section 1F: Spill Characterisation (`predict.py`) (+11 more)

### Community 45 - "oceantrace_frontend/package.json"
Cohesion: 0.10
Nodes (19): description, devDependencies, tsx, @types/node, typescript, vite, vite, name (+11 more)

### Community 46 - "vessels.ts"
Cohesion: 0.19
Nodes (15): latToY(), lonToX(), sampleWind(), gaussian(), gaussianFactory(), mulberry32(), buildFleet(), buildSchedule() (+7 more)

### Community 47 - "OCEANTRACE — Build Plan (v2, orchestrator-merged)"
Cohesion: 0.12
Nodes (16): 10. Risks, 1. Overview & Stack, 2. File Tree, 3. Scenario Constants, 4. Physics Engine (exact spec), 5. Rendering (draw order), 6. UI Spec (every element, computed values only), 7. State (+8 more)

### Community 48 - "fields.ts"
Cohesion: 0.18
Nodes (10): khEff(), lattice(), makeNoise(), _nd, NoiseField, sampleCurrent(), xToLon(), advect() (+2 more)

### Community 49 - "get_dataloaders"
Cohesion: 0.17
Nodes (12): _family(), get_dataloaders(), OilSpillDataset, Tensor, PyTorch Dataset & DataLoader for Trimmed SAR Oil Spill Tiles., Scene-stratified split (oil / lookalike / no-oil separately). No tile leak., 00004_t005.png → 00004; look_00004_t005.png → look_00004., Scene-stratified train/val IDs from processed tiles. Never includes Part III. (+4 more)

### Community 50 - "honesty_check.py"
Cohesion: 0.33
Nodes (15): _add(), check_analyze_no_detect(), check_detect_threshold(), check_eval_frozen(), check_fake_live(), check_guard_module(), check_part3_not_in_train(), check_stale_metrics() (+7 more)

### Community 51 - "environment.js"
Cohesion: 0.20
Nodes (7): createEnvironment(), currentVector(), headingToVec2(), SPECTRA, windVector(), frame(), CurrentField

### Community 52 - "physics.ts"
Cohesion: 0.18
Nodes (9): auditEngineClouds(), TRUE_SRC, cloudHealthy(), buf, eng, check(), fullRun(), run1 (+1 more)

### Community 53 - "scoring.ts"
Cohesion: 0.29
Nodes (12): CandidateScore, fmt(), loiterHours(), ptsDistance(), ptsSpeed(), ptsTime(), ptsType(), scoreCandidate() (+4 more)

### Community 54 - "2. File-by-File Technical Root Causes"
Cohesion: 0.15
Nodes (12): 1. Executive Problem Statement, 2. File-by-File Technical Root Causes, 3. Actionable Improvement Roadmap (For Senior ML Reviewers), Bottleneck A: 8-Bit Compression of SAR Float Data, Bottleneck B: Unused Training Data (58% of Oil Data Missing), Bottleneck C: The "Single-Pixel Trap" in Part 3 Scene Scoring, Bottleneck D: Uniform Sliding-Window Averaging (Tile Edge Discontinuities), Bottleneck E: Lack of Multi-Scale Context in EfficientNet-B0 U-Net (+4 more)

### Community 55 - "Ocean.js"
Cohesion: 0.26
Nodes (3): buildGerstnerWaves(), createRadialGrid(), Ocean

### Community 56 - "loadCase"
Cohesion: 0.29
Nodes (12): applyCase(), fetchFormula(), fillEnv(), loadCase(), paint(), resolveFormula(), scoringFromCase(), selectVessel() (+4 more)

### Community 57 - "OCEANTRACE BUILD_LOG.md"
Cohesion: 0.18
Nodes (10): Build, Errors & fixes (M2), Final file inventory (all per PLAN §2), M3/M4 — UI modules, M5 — Final validation (all exit 0), Nav pill presets (documented per PLAN §6), NOTES (per PLAN §10), OCEANTRACE BUILD_LOG.md (+2 more)

### Community 58 - "FFT.js"
Cohesion: 0.38
Nodes (7): directionalSpread(), gaussianPair(), jonswap(), mulberry32(), phillips(), piersonMoskowitz(), spectrumVariance()

### Community 59 - "tiles.ts"
Cohesion: 0.40
Nodes (9): cache, drawSatelliteTiles(), key(), lat2y(), loadTile(), lon2x(), pickZ(), tileNWlat() (+1 more)

### Community 61 - "OceanTrace — current state (2026-09-13)"
Cohesion: 0.22
Nodes (8): Honesty, Inference now, Leeway (0° = north, 90° = east), Model (frozen checkpoint `oil_unet.pt`), OceanTrace — current state (2026-09-13), Part 3 — test only (450 scenes), Ports, Upload → model

### Community 62 - "2. Full Milestone Chronology"
Cohesion: 0.22
Nodes (8): 1. Project Mission & Architecture, 2. Full Milestone Chronology, 3. Key Files & Workspace Structure, Comprehensive Project Engineering & Training Chronology (Day 1 to Present), Phase 1: Data Preparation & Slicing, Phase 2: Model Training Progression, Phase 3: Zero-Retraining Post-Processing Optimization (`predict.py`), SIH 2024 (Problem SIH 26143) - OceanTrace: Oil Spill Detection System

### Community 63 - "OCEANTRACE Overnight Build — Pipeline Spec (source of truth for watchdog re-spawns)"
Cohesion: 0.29
Nodes (6): BUILDER PROMPT (spawn as oceantrace-builder-N), CRITIC PROMPT (spawn as oceantrace-critic-N), Done criteria, OCEANTRACE Overnight Build — Pipeline Spec (source of truth for watchdog re-spawns), Pipeline stages, PLANNER PROMPT (verbatim — reuse if re-spawning as oceantrace-planner-N)

### Community 64 - "After the hackathon PPT — leftover-data retrain"
Cohesion: 0.29
Nodes (6): After the hackathon PPT — leftover-data retrain, Do not, Gaussian-stitch-only Part 3 (already done, no retrain): **67.0%** oil recall, Dice **0.758**, lookalike **83/150**, no-oil **35/150**., Honesty, Scene counts to add (append only), Steps (1–5). Skip Part 3 until the end.

### Community 65 - "Session summary — inference hardening + honesty checks"
Cohesion: 0.29
Nodes (6): Code that changed, Honesty / verification agent (regular), Later in the same week (PPT / 5175), Sensible next step (when you want it), Session summary — inference hardening + honesty checks, What we did not do

### Community 66 - "get_trained_model"
Cohesion: 0.47
Nodes (5): get_trained_model(), Load and cache the trained U-Net checkpoint if available., main(), Run the trained U-Net in the terminal. Does not start the Map., _score_tile()

### Community 67 - "Honesty check"
Cohesion: 0.33
Nodes (5): Canonical numbers, Do, Do not, Honesty check, Regular cadence

### Community 69 - "Maritime environment (port 5173 — frozen)"
Cohesion: 0.33
Nodes (5): Architecture (later phases), Maritime environment (port 5173 — frozen), Run, Simulation state, What you should see

### Community 70 - "honesty-verifier.md"
Cohesion: 0.40
Nodes (4): Invariants (fail the check if broken), Output, Process, When to invoke

### Community 71 - "Third-party notices"
Cohesion: 0.40
Nodes (4): Implementation references (MIT), Mathematics (public literature), Runtime, Third-party notices

### Community 72 - "OceanTrace (SIH 26143)"
Cohesion: 0.50
Nodes (3): Honesty, ML, OceanTrace (SIH 26143)

### Community 74 - "work-watchdog.md"
Cohesion: 0.50
Nodes (3): Output, Process, When to invoke

## Knowledge Gaps
- **247 isolated node(s):** `name`, `private`, `version`, `type`, `description` (+242 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `get_dataloaders()` connect `get_dataloaders` to `train.py`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Why does `get_dataloaders()` connect `preprocessing.py` to `get_dataloaders`, `manifest.py`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `scene_role_split()` connect `get_dataloaders` to `calibrate.py`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `score_vessel()` (e.g. with `.test_ais_gap_scaled()` and `.test_heading_plateau()`) actually correct?**
  _`score_vessel()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _247 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `score.py` be split into smaller, more focused modules?**
  _Cohesion score 0.10431372549019607 - nodes in this community are weakly interconnected._
- **Should `sea.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07058823529411765 - nodes in this community are weakly interconnected._