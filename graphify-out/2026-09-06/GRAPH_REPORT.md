# Graph Report - .  (2026-09-06)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 547 nodes · 954 edges · 31 communities (27 shown, 4 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 34 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- score.py
- train.py
- frontend/src/main.js
- src/main.js
- FFT
- detect.py
- drift.py
- sea.js
- main.py
- panel.js
- map.js
- frontend/package.json
- package.json
- shrink_and_tile.py
- _gen_coast.py
- SIH judge click script
- waves.js
- upload.js
- selective_trim.py
- investigate.py
- Demo SAR-like preview
- convert_32bit_to_8bit
- Unused dutch-ship PBR pack
- ais.py
- Run investigation analyze
- _layout_out.js
- __init__.py
- Not operational NTRO
- Path

## God Nodes (most connected - your core abstractions)
1. `score_vessel()` - 28 edges
2. `detect_slick()` - 18 edges
3. `renderPanel()` - 16 edges
4. `_closest_approach()` - 14 edges
5. `FFT` - 13 edges
6. `leeway_velocity_ms()` - 10 edges
7. `_first()` - 10 edges
8. `Ocean` - 10 edges
9. `setCase()` - 9 edges
10. `loadCase()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `SIH judge click script` --semantically_similar_to--> `Map investigation tab`  [INFERRED] [semantically similar]
  SIH.md → STATUS.md
- `hull.glb not a tanker` --semantically_similar_to--> `Placeholder warship GLB`  [INFERRED] [semantically similar]
  frontend/public/ships/README.txt → STATUS.md
- `Upload SAR tab` --conceptually_related_to--> `Demo case_001`  [INFERRED]
  STATUS.md → SIH.md
- `Leftover 3D coast dump` --conceptually_related_to--> `Frozen 3D ocean 5173`  [INFERRED]
  _coast_out.txt → SIH.md
- `createMap()` --indirect_call--> `render()`  [INFERRED]
  frontend/src/map.js → frontend/src/sea.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Detect drift score pipeline** — status_leeway, status_ranking_formula, status_run_investigation, status_upload_tab [INFERRED 0.85]
- **Unused historic sailing PBR** — 3dmodels_textures_dutch_ship_pbr, 3dmodels_textures_hull_diffuse, 3dmodels_textures_sails_diffuse, 3dmodels_textures_rigging_diffuse [INFERRED 0.85]

## Communities (31 total, 4 thin omitted)

### Community 0 - "score.py"
Cohesion: 0.10
Nodes (40): _ais_gap_score(), _ais_points(), _angle_delta_deg(), _as_float(), _clamp01(), _closest_approach(), _first(), _fmt_hours() (+32 more)

### Community 1 - "train.py"
Cohesion: 0.06
Nodes (34): Configuration for SAR Oil Spill U-Net Training & Preprocessing., get_dataloaders(), OilSpillDataset, Tensor, PyTorch Dataset & DataLoader for Trimmed SAR Oil Spill Tiles., Scan processed directory and split into train/val DataLoaders., build_model(), calculate_metrics() (+26 more)

### Community 2 - "frontend/src/main.js"
Cohesion: 0.08
Nodes (43): analyzeBtn, analyzeForm, analyzeStatus, app, applyCase(), banner, bindHourSlider(), boot() (+35 more)

### Community 3 - "src/main.js"
Cohesion: 0.08
Nodes (18): clampCamera(), createCamera(), DEFAULT_VIEW, createEnvironment(), currentVector(), headingToVec2(), SPECTRA, windVector() (+10 more)

### Community 4 - "FFT"
Cohesion: 0.09
Nodes (12): FFT, HeightField, directionalSpread(), gaussianPair(), jonswap(), mulberry32(), phillips(), piersonMoskowitz() (+4 more)

### Community 5 - "detect.py"
Cohesion: 0.11
Nodes (37): array, _blob_polygon(), _circle_rc(), _clamp01(), _confidence(), _decode_image(), _decode_pil(), _decode_png() (+29 more)

### Community 6 - "drift.py"
Cohesion: 0.09
Nodes (25): _as_float(), _east_north_ms(), forecast(), hindcast(), _iso_z(), leeway_velocity_ms(), origin_window_iso(), _parse_iso() (+17 more)

### Community 7 - "sea.js"
Cohesion: 0.09
Nodes (30): createSea3d(), normalizeRoot(), TYPE_SCALE, blobPath(), createSea(), drawOil(), drawShip(), drawShipBody() (+22 more)

### Community 8 - "main.py"
Cohesion: 0.19
Nodes (22): analyze_case(), _case_path(), get_case(), health(), investigate_upload(), list_cases(), _ll_dict(), _load_case() (+14 more)

### Community 9 - "panel.js"
Cohesion: 0.26
Nodes (20): compass(), dash(), dlRow(), envBlock(), escapeHtml(), fmtConfidence(), fmtDeg(), fmtNum() (+12 more)

### Community 10 - "map.js"
Cohesion: 0.16
Nodes (13): asLatLon(), deadReckon(), leewayEN(), shiftLatLon(), shiftPolygon(), stepLatLon(), trackPoints(), vesselAtTime() (+5 more)

### Community 11 - "frontend/package.json"
Cohesion: 0.11
Nodes (17): dependencies, leaflet, three, description, devDependencies, vite, three, vite (+9 more)

### Community 12 - "package.json"
Cohesion: 0.11
Nodes (17): lil-gui, dependencies, lil-gui, three, description, devDependencies, vite, three (+9 more)

### Community 13 - "shrink_and_tile.py"
Cohesion: 0.22
Nodes (13): extract_7z_archives(), load_image(), load_mask(), process_dataset(), ndarray, Path, Dataset Shrinking and Tiling Script for Sentinel-1 SAR Oil Spill Data. This…, Main shrinkage and tiling routine. (+5 more)

### Community 14 - "_gen_coast.py"
Cohesion: 0.18
Nodes (5): catmull(), densify(), Mumbai-like peninsula: coastline + zones in Three.js meters., Arc-length resample. Closed rings return n unique verts plus a closing copy., resample_n()

### Community 15 - "SIH judge click script"
Cohesion: 0.18
Nodes (11): Leftover 3D coast dump, hull.glb not a tanker, Demo case_001, SIH judge click script, Frozen 3D ocean 5173, Vite map port 5174, Map investigation tab, Placeholder warship GLB (+3 more)

### Community 16 - "waves.js"
Cohesion: 0.42
Nodes (10): components(), dirUnit(), drawVideoChop(), drawWater(), envParts(), num(), phase(), sampleEta() (+2 more)

### Community 17 - "upload.js"
Cohesion: 0.38
Nodes (9): bindUpload(), buildInvestigateFormData(), detailFromBody(), FORM_FIELDS, formatHttpError(), looksLikeCase(), looksLikeRgbPhoto(), unwrapCase() (+1 more)

### Community 18 - "selective_trim.py"
Cohesion: 0.32
Nodes (7): convert_32bit_to_8bit(), find_top_oil_scenes(), ndarray, Ultra-Low RAM Streaming Trimmer for SAR Oil Spill Dataset (SIH 26143). Strict…, Scan lightweight masks to find scenes with the largest verified oil slicks., Normalize raw 32-bit float radar backscatter (dB) to 8-bit integer (0-255)., stream_and_trim()

### Community 19 - "investigate.py"
Cohesion: 0.43
Nodes (6): _as_latlon(), investigate(), Any, Detect → drift → score case builder. Not operational, not a live feed., Build a case dict: detect_slick → leeway drift → rank_vessels. Raises if…, _region()

### Community 20 - "Demo SAR-like preview"
Cohesion: 0.43
Nodes (7): Case 001 demo overlay, Dark elongated slick, Not live Sentinel-1 GRD, Not NTRO operational imagery, Demo SAR-like preview, SAR speckle, Sea surface

### Community 21 - "convert_32bit_to_8bit"
Cohesion: 0.40
Nodes (5): convert_32bit_to_8bit(), ndarray, Tile already extracted SAR scenes to 8-bit 512x512 chips. Memory & Speed: -…, Normalize raw 32-bit float radar backscatter (dB) to 8-bit integer (0-255)., run_tiling()

### Community 22 - "Unused dutch-ship PBR pack"
Cohesion: 0.50
Nodes (4): Unused dutch-ship PBR pack, Hull diffuse map, Rigging diffuse map, Sails diffuse map

### Community 23 - "ais.py"
Cohesion: 0.50
Nodes (3): parse_ais_csv(), Any, Parse demo AIS CSV. Stdlib only.

### Community 24 - "Run investigation analyze"
Cohesion: 0.50
Nodes (4): Judge desk HTML, Leeway current + 0.03 wind, Explainable ranking weights, Run investigation analyze

## Knowledge Gaps
- **62 isolated node(s):** `COASTLINE`, `ZONES`, `name`, `private`, `version` (+57 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `detect_slick()` connect `detect.py` to `train.py`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `get_trained_model()` connect `train.py` to `detect.py`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `score_vessel()` (e.g. with `.test_ais_gap_scaled()` and `.test_heading_plateau()`) actually correct?**
  _`score_vessel()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `detect_slick()` (e.g. with `get_trained_model()` and `mask_to_latlon_polygon()`) actually correct?**
  _`detect_slick()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `COASTLINE`, `ZONES`, `name` to the rest of the system?**
  _62 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `score.py` be split into smaller, more focused modules?**
  _Cohesion score 0.10431372549019607 - nodes in this community are weakly interconnected._
- **Should `train.py` be split into smaller, more focused modules?**
  _Cohesion score 0.061979648473635525 - nodes in this community are weakly interconnected._