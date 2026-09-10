# SIH 26143 — Forensic Oil Spill Tracker & AI Detection

**Saved progress (what is built vs left):** see `STATUS.md`.  
**Hardware (do not forget):** 16 GB RAM + RTX 4060 **8 GB** VRAM. 512 tiles, AMP, batch ≤ 8, one scene at a time. **New SAR data must be shrunk (32-bit→8-bit, 512 tiles) before any train.**  
**Knowledge graph:** open `graphify-out/graph.html` (report: `graphify-out/GRAPH_REPORT.md`).

This is the **oil-spill investigation map & Deep Learning SAR segmentation system**.

- **AI Detector (Phase B).** U-Net retrained on TIFF **index 1** (DIMAP `Sigma0_VV_db`, the high-contrast pol). Independent val: **Dice 0.881, recall 0.902, precision 0.861.** Map **Run investigation** still does **not** run it. See `STATUS.md`.
- **Trimmed Zenodo part 1.** 1,192 512×512 tiles in `data/processed_512/` (228 MB).
- **Demo case.** Canned SAR + synthetic AIS. Always works offline.
- **Not an operational NTRO system.** Subtitle on the app says so. No fake LIVE badge.
- **Phone photos are not SAR.** Upload is for Sentinel-1 GRD / dataset PNG (VV/VH), not RGB holiday JPEGs.

The cinematic **3D FFT ocean** at the repo root is **frozen**. Do not demo port **5173**. The forensic map is on **http://localhost:5174** (3-minute script default).

**Sea** tab: decorative water (`frontend/public/sea.mp4`, fallback generated waves). Same JSON as Map. Darkened slick + ships overlaid. The video is **not SAR** and is **not used for detection**.

You do not write code. **Two windows, then Chrome.** Leave both windows open.

---

## Start (every time)

### Double-click

1. `E:\oil detector\backend\run.bat` — wait for `Uvicorn running on http://127.0.0.1:8000`
2. `E:\oil detector\frontend\run.bat` — first time runs `npm install`, then Vite
3. Open **http://localhost:5174**

If the map says **Start backend on port 8000**, window 1 is not running.

### Copy-paste (two Command Prompt / PowerShell windows)

**Window 1 — API (port 8000)**

```bat
cd /d "E:\oil detector"
python -m pip install -r backend\requirements.txt
python -m uvicorn main:app --app-dir backend --port 8000
```

**Window 2 — map (port 5174)**

```bat
cd /d "E:\oil detector\frontend"
npm install
npm run dev
```

Then open **http://localhost:5174**

Optional checks: http://127.0.0.1:8000/api/health · `/api/cases` · `/api/score/formula`

---

## 3-minute judge script

Stay on **Map** (default). Header: *Oil spill investigation* / *NTRO SIH 26143 · demo case · not an operational system*.

**Clicks (same for college and SIH):** Map → change current or wind in the dock → **Run investigation** → drag **Time (h)** → click rank-1 tanker → read reasons.

### College / walk-in

1. **Open Map.** Dark SAR overlay west of Mumbai.
2. **Point at the orange-brown polygon** — slick (area km², confidence, age, source **demo**).
3. **Change current or wind** in the bottom dock, then **Run investigation**. That recomputes leeway (`current + 0.03×wind`) and ranks. It does **not** re-detect SAR. Detect chip stays off on the demo.
4. **Drag Time (h).** `t = 0` is the SAR observation. Negative hours = hindcast; positive = forecast. Slick and ships move. Origin marker stays at the leeway source.
5. **Click rank-1** (oil tanker **ARABIAN HORIZON**). Read type, distance to origin, AIS gap.
6. Optional **Sea**: same hour slider, touch a ship to leak. Not map scale. Not SAR. Do not open port **5173**.

### SIH / NTRO-style

Same clicks; say the pipeline:

1. Detect slick on SAR → hindcast origin window → attribute AIS with an **explainable** score.
2. This is **`case_001`**, `slick.source = demo`. **Not NTRO operational.** A U-Net was trained on public Sentinel-1 tiles; **this click path does not run it.** Drift + rank only.
3. Drift is **documented leeway**, not HYCOM, not “AI trajectory.”
4. Formula on the panel: `0.30 type + 0.30 proximity + 0.20 time + 0.10 heading + 0.10 AIS gap`.
5. Rank-1 tanker reasons: **type + distance to hindcast origin + AIS gap**. Rank-last is passenger **KONKAN QUEEN** (far, low type prior).
6. Upload: **Sentinel-1 GRD / dataset PNG. RGB photos are not SAR.** Same detect → drift → score API later.

---

## Honesty (if asked)

| Claim they might hear | Truth |
|---|---|
| Operational NTRO tool | **No.** SIH demo case. |
| LIVE satellite / trained detector | **No live satellite.** Map serves canned JSON. U-Net val Dice **0.881** on public tiles; upload can call it; Map **Run investigation** does not. |
| Phone photo of a beach | **Not SAR.** Reject. |
| AI named the ship | Weighted formula; each ship has `reasons[]`. |
| 3D water is the product | **Frozen.** Map is the product. |
| Sea water footage / generated waves | Visualization only. |
| Real AIS | Synthetic tracks for this demo (PS allows this). |

---

## If it fails

| Symptom | Fix |
|---|---|
| Window flashes closed | Use the copy-paste commands so you can read the error |
| `Python was not found` | Python 3.11+ on PATH, new window |
| `npm` / `node` not found | Node.js LTS, new window, run `frontend\run.bat` again |
| Port 8000 or 5174 in use | Close old server windows |
| You opened **5173** | Frozen 3D ocean. Close it. Use **5174**. |
