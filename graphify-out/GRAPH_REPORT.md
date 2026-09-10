# Graph Report - E:\oil detector  (2026-09-08)

## Corpus Check
- 18 files · ~9,354,479 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 548 nodes · 950 edges · 35 communities (26 shown, 9 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 36 edges (avg confidence: 0.77)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 33

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

## Communities (35 total, 9 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.10
Nodes (40): _ais_gap_score(), _ais_points(), _angle_delta_deg(), _as_float(), _clamp01(), _closest_approach(), _first(), _fmt_hours() (+32 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (42): setTab(), TAB_ORDER, createMap(), createSea3d(), normalizeRoot(), TYPE_SCALE, blobPath(), createSea() (+34 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (36): Configuration for SAR Oil Spill U-Net Training & Preprocessing., get_dataloaders(), OilSpillDataset, Tensor, PyTorch Dataset & DataLoader for Trimmed SAR Oil Spill Tiles., Scan processed directory and split into train/val DataLoaders., build_model(), calculate_metrics() (+28 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (42): analyzeBtn, analyzeForm, analyzeStatus, app, applyCase(), banner, bindHourSlider(), boot() (+34 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (18): clampCamera(), createCamera(), DEFAULT_VIEW, createEnvironment(), currentVector(), headingToVec2(), SPECTRA, windVector() (+10 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (12): FFT, HeightField, directionalSpread(), gaussianPair(), jonswap(), mulberry32(), phillips(), piersonMoskowitz() (+4 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (37): array, _blob_polygon(), _circle_rc(), _clamp01(), _confidence(), _decode_image(), _decode_pil(), _decode_png() (+29 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (25): _as_float(), _east_north_ms(), forecast(), hindcast(), _iso_z(), leeway_velocity_ms(), origin_window_iso(), _parse_iso() (+17 more)

### Community 8 - "Community 8"
Cohesion: 0.19
Nodes (22): analyze_case(), _case_path(), get_case(), health(), investigate_upload(), list_cases(), _ll_dict(), _load_case() (+14 more)

### Community 9 - "Community 9"
Cohesion: 0.26
Nodes (20): compass(), dash(), dlRow(), envBlock(), escapeHtml(), fmtConfidence(), fmtDeg(), fmtNum() (+12 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (17): dependencies, leaflet, three, description, devDependencies, vite, three, vite (+9 more)

### Community 11 - "Community 11"
Cohesion: 0.18
Nodes (12): asLatLon(), deadReckon(), leewayEN(), shiftLatLon(), shiftPolygon(), stepLatLon(), trackPoints(), vesselAtTime() (+4 more)

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (17): lil-gui, dependencies, lil-gui, three, description, devDependencies, vite, three (+9 more)

### Community 13 - "Community 13"
Cohesion: 0.22
Nodes (13): extract_7z_archives(), load_image(), load_mask(), process_dataset(), ndarray, Path, Dataset Shrinking and Tiling Script for Sentinel-1 SAR Oil Spill Data. This…, Main shrinkage and tiling routine. (+5 more)

### Community 14 - "Community 14"
Cohesion: 0.18
Nodes (5): catmull(), densify(), Mumbai-like peninsula: coastline + zones in Three.js meters., Arc-length resample. Closed rings return n unique verts plus a closing copy., resample_n()

### Community 15 - "Community 15"
Cohesion: 0.38
Nodes (9): bindUpload(), buildInvestigateFormData(), detailFromBody(), FORM_FIELDS, formatHttpError(), looksLikeCase(), looksLikeRgbPhoto(), unwrapCase() (+1 more)

### Community 16 - "Community 16"
Cohesion: 0.32
Nodes (7): convert_32bit_to_8bit(), find_top_oil_scenes(), ndarray, Ultra-Low RAM Streaming Trimmer for SAR Oil Spill Dataset (SIH 26143). Strict…, Scan lightweight masks to find scenes with the largest verified oil slicks., Normalize raw 32-bit float radar backscatter (dB) to 8-bit integer (0-255)., stream_and_trim()

### Community 17 - "Community 17"
Cohesion: 0.43
Nodes (6): _as_latlon(), investigate(), Any, Detect → drift → score case builder. Not operational, not a live feed., Build a case dict: detect_slick → leeway drift → rank_vessels. Raises if…, _region()

### Community 18 - "Community 18"
Cohesion: 0.43
Nodes (7): Case 001 demo overlay, Dark elongated slick, Not live Sentinel-1 GRD, Not NTRO operational imagery, Demo SAR-like preview, SAR speckle, Sea surface

### Community 19 - "Community 19"
Cohesion: 0.40
Nodes (5): convert_32bit_to_8bit(), ndarray, Tile already extracted SAR scenes to 8-bit 512x512 chips. Memory & Speed: -…, Normalize one SAR pol (VH if dual-pol) from 32-bit dB to 8-bit., run_tiling()

### Community 20 - "Community 20"
Cohesion: 0.40
Nodes (5): U-Net overlay big slick tile 01210_t003, U-Net overlay faint slick 00970_t010, Old index-0 checkpoint Dice 0.307 recall 0.323, U-Net retrained on TIFF index 1 (DIMAP Sigma0_VV_db), Independent val Dice 0.881 recall 0.902 precision 0.861

### Community 21 - "Community 21"
Cohesion: 0.50
Nodes (4): Unused dutch-ship PBR pack, Hull diffuse map, Rigging diffuse map, Sails diffuse map

### Community 22 - "Community 22"
Cohesion: 0.50
Nodes (3): parse_ais_csv(), Any, Parse demo AIS CSV. Stdlib only.

### Community 24 - "Community 24"
Cohesion: 0.67
Nodes (3): Judge map on port 5174 not frozen 5173, SIH: U-Net val Dice 0.881 not used on Map analyze, Map Run investigation does not re-detect SAR

## Knowledge Gaps
- **66 isolated node(s):** `COASTLINE`, `ZONES`, `name`, `private`, `version` (+61 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `detect_slick()` connect `Community 6` to `Community 2`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `get_trained_model()` connect `Community 2` to `Community 6`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `score_vessel()` (e.g. with `.test_ais_gap_scaled()` and `.test_heading_plateau()`) actually correct?**
  _`score_vessel()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `detect_slick()` (e.g. with `get_trained_model()` and `mask_to_latlon_polygon()`) actually correct?**
  _`detect_slick()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `COASTLINE`, `ZONES`, `name` to the rest of the system?**
  _66 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.10431372549019607 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07058823529411765 - nodes in this community are weakly interconnected._