"""Phase A demo API. Serves canned cases; optionally re-ranks with score.py."""

from __future__ import annotations

import importlib.util
import json
import re
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

BACKEND_DIR = Path(__file__).resolve().parent
ROOT_DIR = BACKEND_DIR.parent
DEMO_DIR = ROOT_DIR / "data" / "demo"

_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$")

# Fallback if score.py is missing. Keep in lockstep with backend/score.py.
_FALLBACK_WEIGHTS = {
    "type": 0.30,
    "proximity": 0.30,
    "time": 0.20,
    "heading": 0.10,
    "ais_gap": 0.10,
}
_FALLBACK_TYPE_PRIORS = {
    "oil_tanker": 1.00,
    "product_tanker": 0.90,
    "chemical_tanker": 0.85,
    "cargo": 0.45,
    "fishing": 0.25,
    "passenger": 0.15,
    "other": 0.30,
}


def _load_score_module() -> Any | None:
    """Import score.py from this folder whether launched as backend.main or --app-dir backend."""
    score_path = BACKEND_DIR / "score.py"
    if not score_path.is_file():
        return None

    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))

    try:
        import score as mod  # type: ignore

        return mod
    except ImportError:
        pass

    spec = importlib.util.spec_from_file_location("score", score_path)
    if spec is None or spec.loader is None:
        return None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_score = _load_score_module()
WEIGHTS: dict[str, float] = dict(getattr(_score, "WEIGHTS", _FALLBACK_WEIGHTS))
TYPE_PRIOR: dict[str, float] = dict(getattr(_score, "TYPE_PRIOR", _FALLBACK_TYPE_PRIORS))
rank_vessels = getattr(_score, "rank_vessels", None)


app = FastAPI(
    title="Oil spill investigation API",
    description=(
        "Phase A: canned demo case. Optional U-Net checkpoint on upload only. "
        "Explainable vessel ranking, not an operational system."
    ),
    version="0.1.0",
)

# Local Vite (5174) + Map UI. Wildcard CORS is for this demo only.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _case_path(case_id: str) -> Path:
    if not _SAFE_ID.match(case_id):
        raise HTTPException(status_code=404, detail="case not found")
    demo = DEMO_DIR.resolve()
    path = (demo / f"{case_id}.json").resolve()
    if not path.is_relative_to(demo) or not path.is_file():
        raise HTTPException(status_code=404, detail="case not found")
    return path


def _load_case(case_id: str) -> dict[str, Any]:
    path = _case_path(case_id)
    try:
        with path.open(encoding="utf-8") as fh:
            data = json.load(fh)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"case JSON is invalid: {exc}") from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=500, detail="case JSON must be an object")
    return data


def _ll_dict(value: Any) -> dict[str, float] | None:
    if isinstance(value, dict) and "lat" in value and "lon" in value:
        return {"lat": float(value["lat"]), "lon": float(value["lon"])}
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        return {"lat": float(value[0]), "lon": float(value[1])}
    return None


def _scoring_origin(case: dict[str, Any]) -> dict[str, float] | None:
    """Proximity origin: first hindcast point (source), else slick centroid."""
    hindcast = (case.get("drift") or {}).get("hindcast") or []
    if isinstance(hindcast, list) and hindcast:
        timed = [p for p in hindcast if isinstance(p, dict) and p.get("t_hours") is not None]
        pick = min(timed, key=lambda p: float(p["t_hours"])) if timed else hindcast[0]
        origin = _ll_dict(pick)
        if origin is not None:
            return origin
    slick = case.get("slick") or {}
    return _ll_dict(slick.get("centroid"))


def _maybe_rerank(case: dict[str, Any]) -> dict[str, Any]:
    if rank_vessels is None:
        return case
    vessels = case.get("vessels")
    if not isinstance(vessels, list) or not vessels:
        return case
    origin = _scoring_origin(case)
    window = (case.get("drift") or {}).get("origin_window")
    toward = ((case.get("environment") or {}).get("current") or {}).get("toward_deg")
    if origin is None or not isinstance(window, dict) or toward is None:
        return case
    try:
        case["vessels"] = rank_vessels(vessels, origin, window, float(toward))
    except Exception:
        return case
    return case


@app.get("/api/health")
def health() -> dict[str, Any]:
    model_file = BACKEND_DIR / "models" / "oil_unet.pt"
    trained = model_file.is_file()
    return {
        "ok": True,
        "phase": "B-checkpoint" if trained else "A",
        "detector": (
            "unet checkpoint present — upload path only, not Map analyze"
            if trained
            else "not trained yet — demo case"
        ),
        "model_file": str(model_file.name) if trained else None,
    }


@app.get("/api/cases")
def list_cases() -> list[dict[str, Any]]:
    if not DEMO_DIR.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for path in sorted(DEMO_DIR.glob("*.json")):
        try:
            with path.open(encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        out.append(
            {
                "id": data.get("id", path.stem),
                "title": data.get("title"),
                "region": data.get("region"),
                "observed_at": data.get("observed_at"),
            }
        )
    return out


@app.get("/api/cases/{case_id}")
def get_case(case_id: str) -> dict[str, Any]:
    case = deepcopy(_load_case(case_id))
    return _maybe_rerank(case)


@app.get("/api/score/formula")
def score_formula() -> dict[str, Any]:
    w = WEIGHTS
    return {
        "formula": (
            f"{float(w.get('type_prior', w.get('type', 0.30))):.2f}*type + "
            f"{float(w.get('proximity', 0.30)):.2f}*proximity + "
            f"{float(w.get('time', 0.20)):.2f}*time + "
            f"{float(w.get('heading', 0.10)):.2f}*heading + "
            f"{float(w.get('ais_gap', 0.10)):.2f}*ais_gap"
        ),
        "weights": w,
        "type_priors": TYPE_PRIOR,
        "origin": "first drift.hindcast point (source), else slick.centroid",
        "scorer": "backend/score.py" if rank_vessels is not None else "not loaded — canned JSON as-is",
        "note": (
            "Explainable weighted formula for the Phase A demo. "
            "Not an operational system."
        ),
    }


@app.post("/api/investigate")
async def investigate_upload(
    sar: UploadFile = File(...),
    ais: UploadFile | None = File(None),
    wind_speed: float = Form(8.0),
    wind_toward: float = Form(72.0),
    current_speed: float = Form(0.5),
    current_toward: float = Form(90.0),
    observed_at: str = Form("2024-03-12T06:40:00Z"),
    south: float = Form(18.48),
    west: float = Form(71.62),
    north: float = Form(18.82),
    east: float = Form(72.18),
) -> dict[str, Any]:
    """Run detect -> drift -> score on an uploaded SAR-like image. Not operational."""
    raw = await sar.read()
    if not raw:
        raise HTTPException(400, "Empty SAR file")
    name = (sar.filename or "").lower()
    if name.endswith((".jpg", ".jpeg", ".webp")):
        raise HTTPException(
            400,
            "RGB holiday photos are not Sentinel-1 SAR. Use a dataset PNG or GeoTIFF (VV/VH).",
        )
    try:
        import ais as ais_mod
        import investigate as inv
    except ImportError as exc:
        raise HTTPException(501, f"Pipeline not loaded yet ({exc})") from exc

    bounds = [[south, west], [north, east]]
    wind = {"speed_ms": wind_speed, "toward_deg": wind_toward}
    current = {"speed_ms": current_speed, "toward_deg": current_toward}
    records: list[dict[str, Any]] = []
    if ais is not None:
        text = (await ais.read()).decode("utf-8", errors="replace")
        records = ais_mod.parse_ais_csv(text)
    try:
        case = inv.investigate(raw, bounds, wind, current, records, observed_at)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except ImportError as exc:
        raise HTTPException(501, f"Pipeline not loaded yet ({exc})") from exc
    ranked = _maybe_rerank(case)
    # Persist so Map "Run investigation" can re-drift the upload instead of 404.
    try:
        upload_path = DEMO_DIR / "upload_001.json"
        upload_path.write_text(json.dumps(ranked, indent=2), encoding="utf-8")
    except OSError:
        pass
    return ranked


@app.post("/api/cases/{case_id}/analyze")
async def analyze_case(
    case_id: str,
    wind_speed: float = Form(...),
    wind_toward: float = Form(...),
    current_speed: float = Form(...),
    current_toward: float = Form(...),
) -> dict[str, Any]:
    """Recompute leeway drift + ranks. Does not run detect (no SAR bytes)."""
    case = deepcopy(_load_case(case_id))
    try:
        import drift
    except ImportError as exc:
        raise HTTPException(501, f"drift.py not loaded ({exc})") from exc

    wind = {"speed_ms": float(wind_speed), "toward_deg": float(wind_toward)}
    current = {"speed_ms": float(current_speed), "toward_deg": float(current_toward)}
    case["environment"] = {"wind": wind, "current": current}

    slick = case.get("slick") if isinstance(case.get("slick"), dict) else {}
    centroid = _ll_dict(slick.get("centroid"))
    if centroid is None:
        raise HTTPException(status_code=400, detail="case has no slick centroid")
    age = float(slick.get("age_hours_est") or 16)
    hind = drift.hindcast(centroid["lat"], centroid["lon"], wind, current, hours=age)
    fore = drift.forecast(centroid["lat"], centroid["lon"], wind, current)
    observed = str(case.get("observed_at") or "2024-03-12T06:40:00Z")
    window = drift.origin_window_iso(observed, age)
    case["drift"] = {
        "hindcast": hind,
        "forecast": fore,
        "origin_window": window,
        "method": f"leeway: current + {drift.WIND_FACTOR:g}*wind",
    }
    case["pipeline"] = {
        "ingest": True,
        "detect": False,
        "drift": True,
        "ais": bool(case.get("vessels")),
        "score": rank_vessels is not None,
    }
    return _maybe_rerank(case)


if DEMO_DIR.is_dir():
    app.mount("/demo", StaticFiles(directory=str(DEMO_DIR)), name="demo")
