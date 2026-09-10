"""Detect → drift → score case builder. Not operational, not a live feed."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

_BACKEND = Path(__file__).resolve().parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


def _as_latlon(value: Any) -> tuple[float, float] | None:
    if isinstance(value, dict):
        if "lat" in value and "lon" in value:
            return float(value["lat"]), float(value["lon"])
        return None
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        return float(value[0]), float(value[1])
    return None


def _region(bounds: Any) -> str:
    try:
        sw, ne = bounds[0], bounds[1]
        south, west = float(sw[0]), float(sw[1])
        north, east = float(ne[0]), float(ne[1])
    except (TypeError, ValueError, IndexError, KeyError):
        return "user upload"
    return f"{south:.2f}–{north:.2f}N, {west:.2f}–{east:.2f}E"


def investigate(
    sar_bytes: bytes,
    bounds: list,
    wind: dict,
    current: dict,
    ais_records: list,
    observed_at_iso: str,
) -> dict:
    """Build a case dict: detect_slick → leeway drift → rank_vessels.

    Raises if detect, drift, or score cannot be imported, or if detection fails.
    Empty ais_records → vessels=[].
    """
    try:
        import detect
    except ImportError:
        raise

    slick = detect.detect_slick(sar_bytes, bounds)
    if not isinstance(slick, dict):
        raise ValueError("detect_slick must return a dict")
    slick = dict(slick)
    slick.setdefault("source", "baseline-darkspot")

    centroid = _as_latlon(slick.get("centroid"))
    if centroid is None:
        raise ValueError("detect_slick did not return a lat/lon centroid")
    lat, lon = centroid

    try:
        import drift
    except ImportError:
        raise

    wind = dict(wind or {})
    current = dict(current or {})
    age = float(slick.get("age_hours_est") or 16)
    hind = drift.hindcast(lat, lon, wind, current, hours=age)
    fore = drift.forecast(lat, lon, wind, current)
    window = drift.origin_window_iso(observed_at_iso, age)

    try:
        import score
    except ImportError:
        raise

    records = list(ais_records or [])
    if records:
        # Proximity origin is the hindcast source (first point), else the slick centroid.
        if hind:
            timed = [p for p in hind if isinstance(p, dict) and p.get("t_hours") is not None]
            pick = min(timed, key=lambda p: float(p["t_hours"])) if timed else hind[0]
            origin = {"lat": float(pick["lat"]), "lon": float(pick["lon"])}
        else:
            origin = {"lat": lat, "lon": lon}
        toward = float(current.get("toward_deg") or 0)
        vessels = score.rank_vessels(records, origin, window, toward)
    else:
        vessels = []

    src = str(slick.get("source") or "baseline-darkspot")
    note = slick.get("note") or (
        "Baseline dark-spot. Not a trained model. Not a live detector product."
    )
    unet = src.startswith("unet")
    return {
        "id": "upload_001",
        "title": "Uploaded SAR — U-Net" if unet else "Uploaded SAR — baseline dark-spot",
        "region": _region(bounds),
        "observed_at": observed_at_iso,
        "sar": {
            "image_url": "",
            "bounds": bounds,
            "sensor": "upload",
            "note": note,
        },
        "environment": {"wind": wind, "current": current},
        "slick": slick,
        "drift": {
            "hindcast": hind,
            "forecast": fore,
            "origin_window": window,
            "method": f"leeway: current + {drift.WIND_FACTOR:g}*wind",
        },
        "vessels": vessels,
        "scoring": {
            "source": src,
            "note": (
                "Explainable rule weights (type, proximity, time, heading, AIS gap). "
                f"Slick source is {src}. Not live AIS. Not operational NTRO."
            ),
        },
        "pipeline": {
            "ingest": True,
            "detect": True,
            "drift": True,
            "ais": bool(vessels),
            "score": True,
        },
    }
