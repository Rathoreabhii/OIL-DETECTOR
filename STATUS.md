# SIH 26143 — work saved so far

**Live snapshot (numbers, leftover train, upload):** `CURRENT_STATE.md`.  
**Part 3 JSON (`backend/models/oil_unet_part3_test.json`):** still reflects 30ep NEW weights — Scene Hit Rate **98.7% (148/150)**; 30ep: oil pixel recall **54.2%**, Dice **0.662**, prec **85.0%**, lookalike FA **78/150**, no-oil **31/150**. **ACTIVE `oil_unet.pt` is `backup_run2.pt` lineage (~67% recall, Dice 0.758–0.764). `oil_unet_part3_test.json` is STALE until one frozen re-eval after night retrain.** Do not quote Dice 0.881 (retired leaky tile split). Tile-val `oil_unet_metrics_backup.json` epoch 15: Dice 0.844, recall 0.896, precision 0.798.

Date of this file’s older sections: 2026-09-06. Sections below that still say 1,192 tiles or 0.881 as “independent val” are **historical**. Working set is **9,296 tiles**.

## Hardware (always — every agent, every train, every verify)

This laptop is **not** a workstation. Treat these as hard caps, not hints:

| Resource | Cap | What that forbids |
|---|---|---|
| RAM | **16 GB** | No full 2048×2048×2 float32 stacks. One scene at a time. `NUM_WORKERS` 0–2. Do not unzip more of the 40 GB archive into RAM. |
| GPU | **RTX 4060 Laptop, 8 GB VRAM** | EfficientNet-B0 U-Net, **512×512**, **batch ≤ 8**, **AMP on**. No B3+/2048 forward/batch 16. |
| Disk | Oil TIFFs ~**48 GB** extracted + masks ~**5 GB**. Part 1 **images.7z deleted** (user). | Tiles (228 MB) are the working set. E: has free space; still do not keep extra full extracts without tiling. |

**New data rule (user, standing):** whenever the user gives more Zenodo/SAR (Part 2 lookalike / no-oil, extra scenes, anything 32-bit), **do not train or infer on the raw TIFFs.** Always: one scene at a time → **32-bit dB → 8-bit** → **512×512** tiles (64 px overlap) → `mask > 0` (or class-correct mapping) → keep a small fraction of empty sea. Then train AMP / batch ≤ 8 on those PNGs only. Images and masks come as **pairs** (lookalike images+mask, no-oil images+mask). Do not unzip a 20+ GB archive into RAM.

Allowed tools that already fit: 32-bit dB → 8-bit PNG, 512 tiles, `mask > 0`, TIFF **index 1** (DIMAP `Sigma0_VV_db`). A verifier that ignores this table is wrong.

**Measured on this GPU (torch peak allocated, 2026-09-06):** U-Net load **0.09 GB**; 512 and 810×1280 infer **0.11 GB**; dummy batch-8 AMP step **2.83 GB** (~5 GB headroom). Real 25-epoch train already finished here, so train VRAM fits. Code constants: `HOST_RAM_GB=16`, `HOST_VRAM_GB=8` in `backend/ml/config.py`.

This is a **Phase A demo + Phase B Deep Learning AI Segmentation** project. Phase A Map is still the judge click path. Phase B U-Net was **re-tiled on TIFF index 1 and retrained**; numbers below are from an independent val re-run, not a STATUS guess.

## How to run (you start these locally)

Window 1:

```bat
cd /d "E:\oil detector"
python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Window 2:

```bat
cd /d "E:\oil detector\frontend"
npm run dev
```

Browser: **http://localhost:5174** (not 5173 — that is the frozen 3D FFT ocean).

`oceantrace_frontend/` on **http://localhost:5175** (Vite proxies `/api` + `/demo` → 8000). **Truth layer** = `case_001` (ARABIAN HORIZON, leeway, API ranks 30/30/20/10/10). **Particles** = local simulation, not the U-Net, not OpenDrift. If API is down, splash must error — no silent Ocean Pride. Judge script remains **5174**. Not 5173.

## Deep Learning AI Segmentation (Phase B — retrained on high-contrast pol)

Hardware: 16 GB RAM + RTX 4060 8 GB. AMP, batch 8, 512×512, one scene at a time. **25 epochs in 13.7 min.** Best weights **epoch 9**.

**Polarization (FABLE-corrected):** Zenodo TIFFs are 2048×2048×2. DIMAP names **band 0 = Sigma0_VH_db, band 1 = Sigma0_VV_db**. Oil–sea contrast is on **index 1** (about 4–10 dB). Index 0 is near noise (about 1 dB). We tile **index 1**. Do not switch to index 0 because a comment said “VH”.

**Tiles (this run):** `data/processed_512/` **1,192** L-mode PNGs, **228 MB**, 988 oil + 204 sea, `mask > 0`. Old low-contrast tiles were wiped first. Backup of the weak checkpoint: `backend/models/oil_unet_vv_ep14.pt` (name is historical; that file was the **index-0** 0.27-Dice run).

**Mixed train 2026-09-11 (Part 1 oil + Part 2 lookalike/no-oil, hardware-safe):**

- Tiler **did not wipe** oil tiles. Appended `look_*` 564 + `noil_*` 100 (one scene in RAM, GPU idle).
- Scene-stratified split: oil 120/30, look 117/29, noil 39/10 scenes. **No shared scenes.**
- Fine-tune from `oil_unet_part1.pt` weights only, fresh Adam, `NUM_WORKERS=0`, batch 8, AMP. **25.1 min, no OOM** (8.0 GB VRAM free at start).
- Best **epoch 21**: global Dice **0.855**, recall **0.842**, precision **0.868**, lookalike FP **0.0008** (val look tiles almost never painted as oil).
- Smoke: tile Dice 0.895 / 0.901; demo PNG `unet-sentinel1` area **0.08 km²** (tighter than the old 1.74 km² over-paint).
- Retired: leaky Part-1-only Dice **0.881** (tiles from the same scene in train and val). Do not quote 0.881 as the current score.

**Update 2026-09-21 — tiling expanded (append-only, old tiles untouched):**
- On disk now: **25,168** tiles (16,287 oil / 6,691 look / 2,190 noil) from **1,200 oil + 685 look + 350 noil** scenes.
- Manifest `backend/models/split_manifest.json` hash `40b2b45dd2e0` (train/model_val/calibration scene-disjoint, Part-3 guarded).
- Old "9,296 tiles" counts retired in `CURRENT_STATE.md`.

**Update 2026-09-21 — active model lineage:**
- Active `oil_unet.pt` = `oil_unet_backup_run2.pt` copy (Run 2 lineage, ~67% Part 3 recall).
- Preserved: `oil_unet_new_30ep_54recall.pt` (30ep retrain), `oil_unet_metrics_new.json`, `calibration_part12_new_54recall.json`. Original `oil_unet_backup_run2.pt` untouched.
- Tile-val active lineage (`oil_unet_metrics_backup.json` epoch 15): Global Dice **0.844**, recall **0.896**, precision **0.798**.
- Part 1/2 calibration 2026-09-21 (60 scenes, active OLD weights): recall **0.9197**, precision **0.8500**, Dice **0.8835** (single 0.15/200). Hysteresis alt 0.15/0.35 blob 450: recall 0.9180, prec 0.8524, FA 9+4=13. Saved as `calibration_part12_old_67recall.json`. Previous NEW calibration 0.9056/0.8642/0.8844 saved as `calibration_part12_new_54recall.json`. Dry-run resolves 447 scenes (240 oil / 137 look / 70 noil).
- `train.py:178` still `focal_gamma=2.0` — set 0.0 before night retrain.

**Independent val (old leaky SEED=42 tile split — retired):**

| | old index-0 weights | new index-1 weights |
|---|---|---|
| epoch | 14 | **9** (best of 25) |
| global Dice | 0.307 | **0.881** |
| recall | 0.323 | **0.902** |
| precision | 0.293 | **0.861** |
| oil tiles with Dice 0 | 110 / 198 | **5 / 198** |

Written to `backend/models/oil_unet_metrics.json`. `train.py` now logs **global** Dice/recall/precision (batch-mean Dice is no longer the saved score).

**Smoke detects (same machine):**

- Tile `00970_t010` (was max prob 0.23 / empty U-Net): now `source=unet-sentinel1`, conf **0.904**.
- Demo `sar_preview.png` (was 758 km² / 43% of the raster): now `source=unet-sentinel1`, area **1.74 km²**, conf **0.828** (formula `0.25+0.70*mean_p`, not 0.88).

**Wiring (honest):**

- Map **Run investigation** still `pipeline.detect=False` on canned `case_001`. Correct for the 3-minute script.
- Upload `POST /api/investigate` tries U-Net; empty polygon or load error → dark-spot and a **stderr** line. Case is written to `data/demo/upload_001.json` so a later Analyze does not 404.
- `/api/health` = file present, “upload path only, not Map analyze”. Restart the API after this retrain (`_CACHED_MODEL`).
- `backend/requirements.txt` still has no torch; ML deps are `backend/ml/requirements.txt`.
- Inference builds SMP with `encoder_weights=None` (no ImageNet download at serve time).

## What a judge can click today

1. **Map** — Esri imagery, SAR overlay, slick, leeway origin, ranked AIS ships.
2. Change **wind / current** in the bottom dock → **Run investigation** → recomputes drift and ranks (`current + 0.03×wind`). Does **not** re-detect SAR on the demo.
3. Drag **Time (h)** — `t = 0` is the SAR observation; negative = hindcast; positive = forecast. Slick and ships move.
4. Click rank-1 **ARABIAN HORIZON** — type, distance to origin, AIS gap.
5. **Sea** — close-up of the same six ships, larger 3D placeholder hulls, click to leak, same hour slider, ship sidebar.
6. **Upload** — Sentinel-1 GRD / dataset PNG only. JPEG rejected.

## Physics and ranking (honest)

- Leeway: **100% current + 3% wind**. `toward_deg`: **0 = north, 90 = east** (AIS heading). Older “0 = east” notes are wrong for `case_001` / current `drift.py`.
- Score: **0.30 type + 0.30 proximity + 0.20 time + 0.10 heading + 0.10 AIS gap**.
- Demo case `case_001` is canned SAR-like PNG + synthetic AIS. Source = **demo**.
- Analyze route: `POST /api/cases/{id}/analyze` (drift + score only).
- Upload route: `POST /api/investigate` (U-Net if checkpoint loads, else dark-spot → drift → score).

## What we built (files)

| Area | Files |
|---|---|
| Deep Learning ML | `backend/ml/config.py`, `trim_and_tile.py`, `dataset.py`, `model.py`, `train.py`, `predict.py` |
| Trained Weights | `backend/models/oil_unet.pt` (RTX 4060 trained checkpoint) |
| Trimmed Data | `data/processed_512/images/`, `data/processed_512/masks/` (1,192 tiles, 228 MB, TIFF index 1) |
| Metrics | `backend/models/oil_unet_metrics.json` (Dice 0.881 / rec 0.902 / prec 0.861) |
| Old weights | `backend/models/oil_unet_vv_ep14.pt` (index-0 run, Dice 0.27) |
| API | `backend/main.py`, `detect.py`, `drift.py`, `score.py`, `investigate.py`, `ais.py` |
| Map UI | `frontend/src/map.js`, `panel.js`, `main.js`, `time.js`, `leeway.js` |
| Sea UI | `frontend/src/sea.js`, `sea-3d.js`, `sea-media.js`, `waves.js` |
| Upload | `frontend/src/upload.js` (bbox south/west/north/east) |
| Demo data | `data/demo/case_001.json`, `case_002.json`, `sar_preview.png` |
| Judge script | `SIH.md` |
| 3D hull | `frontend/public/ships/hull.glb` — **placeholder warship**, not a tanker class |

## What we refused to fake

- LIVE / All Systems Online / operational NTRO
- Oil detected in the water video
- ±8 km uncertainty disc (no covariance model)
- Wind field arrows from one vector
- Detect chip on canned demo
- Frozen FFT ocean on port 5173

## Left to do

- Dual-pol (index 0 + 1) would need a new detect/predict path; grayscale upload cannot carry two bands. Not this demo.
- Polygon is still a 16-vertex star, not a contour. Area uses the full binary mask.
- Real Sentinel-1 GeoTIFF dual-pol is not decoded as two bands (upload is PNG/JPEG → gray).
- Disk: extracted Oil TIFFs ~48 GB still on disk; Part 1 **images.7z already deleted**. Masks ~5 GB.
- Restart API after this retrain. Do not use `run_trim.bat` (it launches `selective_trim.py`, not the SEED=42 tiler).
- Real tanker/cargo GLBs (current hull is one cloned warship)
- Real AIS / live Sentinel-1 GRD ingest
- HYCOM or any real ocean model
- Browser-proof of Sea video + 3D on this machine
- Judge Map path stays canned demo (`slick.source=demo`). Upload is the U-Net path.
- **Astra audit (`ASTRA_GAP_ANALYSIS_AND_VERIFICATION.md`):** scene-level train/val leak is real (118/150 scenes overlap; val is not unseen). Star polygon is real. Dual-pol / OpenDrift / second dashboard / Focal-as-bug / “no AIS tracks” are oversold or false. Grok verdict is at the top of that file.

## Graph (this run)

Open `graphify-out/graph.html` in a browser (no server). Report: `graphify-out/GRAPH_REPORT.md`. Raw: `graphify-out/graph.json`.

- **548 nodes · 950 edges · 35 communities** (incremental update: code + `STATUS.md` + `SIH.md` + U-Net preview images; skipped 2,000+ training-tile PNGs)
- Core hubs: `score_vessel()`, `detect_slick()`, `renderPanel()`, `_closest_approach()`, `FFT`
- Includes index-1 retrain metrics (Dice 0.881) and 16 GB / 8 GB hardware caps
- Token cost this graphify run: 0 billed Gemini tokens (AST + host semantic on STATUS/SIH)
