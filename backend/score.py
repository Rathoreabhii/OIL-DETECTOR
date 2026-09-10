"""Explainable vessel ranking for oil-source attribution (NTRO SIH demo).

score = 0.30*type_prior + 0.30*proximity + 0.20*time + 0.10*heading + 0.10*ais_gap

Rule weights only. No network, no live model.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

EARTH_RADIUS_KM = 6371.0
PROXIMITY_RANGE_KM = 40.0
TIME_DECAY_HOURS = 24.0
HEADING_ALIGN_DEG = 30.0
HEADING_ZERO_DEG = 180.0
AIS_GAP_FULL_MIN = 30.0

WEIGHTS = {
    "type_prior": 0.30,
    "proximity": 0.30,
    "time": 0.20,
    "heading": 0.10,
    "ais_gap": 0.10,
}

TYPE_PRIOR = {
    "oil_tanker": 1.00,
    "product_tanker": 0.90,
    "chemical_tanker": 0.85,
    "cargo": 0.45,
    "fishing": 0.25,
    "passenger": 0.15,
    "other": 0.30,
}

TYPE_REASONS = {
    "oil_tanker": "Oil tanker — persistent cargo oil risk",
    "product_tanker": "Product tanker — refined petroleum cargo risk",
    "chemical_tanker": "Chemical tanker — hazardous liquid cargo risk",
    "cargo": "Cargo vessel — lower persistent-oil risk",
    "fishing": "Fishing vessel — incidental fuel-oil risk",
    "passenger": "Passenger vessel — low cargo-oil risk",
    "other": "Other vessel type — uncategorised oil risk",
}

# Plain-language aliases plus AIS numeric ship-and-cargo types (ITU-R M.1371).
_TYPE_ALIASES = {
    "tanker": "oil_tanker",
    "oil tanker": "oil_tanker",
    "crude tanker": "oil_tanker",
    "crude oil tanker": "oil_tanker",
    "product tanker": "product_tanker",
    "oil product tanker": "product_tanker",
    "chemical tanker": "chemical_tanker",
    "chem tanker": "chemical_tanker",
    "cargo": "cargo",
    "cargo ship": "cargo",
    "general cargo": "cargo",
    "container": "cargo",
    "container ship": "cargo",
    "bulk carrier": "cargo",
    "bulk": "cargo",
    "fishing": "fishing",
    "fishing vessel": "fishing",
    "trawler": "fishing",
    "passenger": "passenger",
    "passenger ship": "passenger",
    "passenger vessel": "passenger",
    "ferry": "passenger",
    "other": "other",
}


def _clamp01(value: float) -> float:
    if value <= 0.0:
        return 0.0
    if value >= 1.0:
        return 1.0
    return float(value)


def _first(obj: dict, *keys: str) -> Any:
    for key in keys:
        if key in obj and obj[key] is not None and obj[key] != "":
            return obj[key]
    return None


def _as_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_type(vessel_type: Any) -> str:
    if vessel_type is None or vessel_type == "":
        return "other"
    if isinstance(vessel_type, bool):
        return "other"
    if isinstance(vessel_type, (int, float)) and not isinstance(vessel_type, bool):
        code = int(vessel_type)
        if 80 <= code <= 89:
            return "oil_tanker"
        if 70 <= code <= 79:
            return "cargo"
        if code == 30:
            return "fishing"
        if 60 <= code <= 69:
            return "passenger"
        return "other"
    key = " ".join(str(vessel_type).strip().lower().replace("-", " ").replace("_", " ").split())
    underscored = key.replace(" ", "_")
    if underscored in TYPE_PRIOR:
        return underscored
    return _TYPE_ALIASES.get(key, "other")


def type_prior(type: str) -> float:
    """Return the oil-risk prior for a vessel type in [0, 1]."""
    return float(TYPE_PRIOR[_normalize_type(type)])


def _latlon(obj: Any) -> tuple[float, float] | None:
    if not isinstance(obj, dict):
        return None
    lat = _as_float(_first(obj, "lat", "latitude", "lat_deg"))
    lon = _as_float(_first(obj, "lon", "lng", "longitude", "lon_deg"))
    if lat is not None and lon is not None:
        return lat, lon
    pos = obj.get("position") or obj.get("pos")
    if isinstance(pos, dict):
        return _latlon(pos)
    if isinstance(pos, (list, tuple)) and len(pos) >= 2:
        a, b = _as_float(pos[0]), _as_float(pos[1])
        if a is None or b is None:
            return None
        return a, b
    return None


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2.0) ** 2
    return 2.0 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def _parse_time(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        ts = float(value)
        if ts > 1e12:
            ts /= 1000.0
        try:
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        except (OSError, OverflowError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    return None


def _window_bounds(origin_window: Any) -> tuple[datetime | None, datetime | None]:
    if origin_window is None:
        return None, None
    if isinstance(origin_window, (list, tuple)) and len(origin_window) >= 2:
        start, end = _parse_time(origin_window[0]), _parse_time(origin_window[1])
    elif isinstance(origin_window, dict):
        start = _parse_time(_first(origin_window, "start", "from", "t0", "start_ts", "begin"))
        end = _parse_time(_first(origin_window, "end", "to", "t1", "end_ts", "stop"))
    else:
        return None, None
    if start is not None and end is not None and start > end:
        start, end = end, start
    return start, end


def _ais_points(vessel: dict) -> list[dict]:
    raw = _first(vessel, "ais_points", "ais", "track", "positions", "points") or []
    if not isinstance(raw, (list, tuple)):
        return []
    return [p for p in raw if isinstance(p, dict)]


def _point_time(point: dict) -> datetime | None:
    return _parse_time(_first(point, "t", "time", "timestamp", "ts", "datetime"))


def _vessel_latlon(vessel: dict) -> tuple[float, float] | None:
    pair = _latlon(vessel)
    if pair is not None:
        return pair
    points = _ais_points(vessel)
    for point in reversed(points):
        pair = _latlon(point)
        if pair is not None:
            return pair
    return None


def _closest_approach(
    vessel: dict,
    origin_ll: tuple[float, float] | None,
    start: datetime | None,
    end: datetime | None,
) -> dict[str, Any] | None:
    """Min distance to origin; prefer AIS hits inside the origin window."""
    if origin_ll is None:
        return None
    candidates: list[dict[str, Any]] = []
    for point in _ais_points(vessel):
        pll = _latlon(point)
        if pll is None:
            continue
        km = _haversine_km(pll[0], pll[1], origin_ll[0], origin_ll[1])
        ts = _point_time(point)
        in_win = bool(start and end and ts and start <= ts <= end)
        cog = _as_float(_first(point, "cog", "heading", "course"))
        candidates.append({"km": km, "ll": pll, "t": ts, "cog": cog, "in_win": in_win})
    if not candidates:
        pair = _vessel_latlon(vessel)
        if pair is None:
            return None
        km = _haversine_km(pair[0], pair[1], origin_ll[0], origin_ll[1])
        return {"km": km, "ll": pair, "t": _vessel_timestamp(vessel), "cog": _vessel_cog(vessel), "in_win": False}
    return min(candidates, key=lambda c: c["km"])


def _vessel_timestamp(vessel: dict) -> datetime | None:
    parsed = _parse_time(_first(vessel, "timestamp", "time", "t", "ts", "datetime"))
    if parsed is not None:
        return parsed
    times = [_point_time(p) for p in _ais_points(vessel)]
    times = [t for t in times if t is not None]
    return max(times) if times else None


def _vessel_cog(vessel: dict) -> float | None:
    cog = _as_float(_first(vessel, "cog", "heading", "course", "course_over_ground"))
    if cog is not None:
        return cog % 360.0
    for point in reversed(_ais_points(vessel)):
        cog = _as_float(_first(point, "cog", "heading", "course"))
        if cog is not None:
            return cog % 360.0
    return None


def _angle_delta_deg(a: float, b: float) -> float:
    delta = abs(a - b) % 360.0
    return delta if delta <= 180.0 else 360.0 - delta


def _hours_outside(when: datetime, start: datetime, end: datetime) -> float:
    if start <= when <= end:
        return 0.0
    if when < start:
        return (start - when).total_seconds() / 3600.0
    return (when - end).total_seconds() / 3600.0


def _proximity_score(distance_km: float | None) -> float:
    if distance_km is None:
        return 0.0
    return _clamp01(1.0 - distance_km / PROXIMITY_RANGE_KM)


def _time_score(hours_out: float | None) -> float:
    if hours_out is None:
        return 0.0
    return _clamp01(1.0 - hours_out / TIME_DECAY_HOURS)


def _heading_score(delta_deg: float | None) -> float:
    # 1 inside ±30°, then linear to 0 at 180°.
    if delta_deg is None:
        return 0.0
    if delta_deg <= HEADING_ALIGN_DEG:
        return 1.0
    span = HEADING_ZERO_DEG - HEADING_ALIGN_DEG
    return _clamp01(1.0 - (delta_deg - HEADING_ALIGN_DEG) / span)


def _ais_gap_score(max_gap_min: float | None) -> float:
    if max_gap_min is None or max_gap_min < 0.0:
        return 0.0
    return _clamp01(max_gap_min / AIS_GAP_FULL_MIN)


def score_vessel(
    vessel: dict,
    origin: dict,
    origin_window: dict,
    current_toward_deg: float,
) -> dict:
    """Score one vessel. Returns score in [0, 1] (3 d.p.), reasons, components."""
    origin = origin or {}
    origin_window = origin_window or {}
    vessel = vessel or {}

    type_key = _normalize_type(_first(vessel, "type", "vessel_type", "ship_type", "shiptype"))
    tp = type_prior(type_key)

    origin_ll = _latlon(origin)
    start, end = _window_bounds(origin_window)
    approach = _closest_approach(vessel, origin_ll, start, end)
    distance_km = approach["km"] if approach else None
    prox = _proximity_score(distance_km)
    samples: list[datetime] = []
    primary = _vessel_timestamp(vessel)
    if primary is not None:
        samples.append(primary)
    for point in _ais_points(vessel):
        pt = _point_time(point)
        if pt is not None:
            samples.append(pt)

    hours_out: float | None = None
    used_time: datetime | None = None
    if start is not None and end is not None and samples:
        ranked_times = sorted(samples, key=lambda t: _hours_outside(t, start, end))
        used_time = ranked_times[0]
        hours_out = _hours_outside(used_time, start, end)
    tscore = _time_score(hours_out)

    toward = _as_float(current_toward_deg)
    if toward is not None:
        toward = toward % 360.0
    cog = approach["cog"] if approach and approach.get("cog") is not None else _vessel_cog(vessel)
    if cog is not None:
        cog = cog % 360.0
    heading_delta = _angle_delta_deg(cog, toward) if cog is not None and toward is not None else None
    hscore = _heading_score(heading_delta)

    max_gap_min: float | None = None
    timed = [( _point_time(p), p) for p in _ais_points(vessel)]
    timed = [(t, p) for t, p in timed if t is not None]
    timed.sort(key=lambda x: x[0])
    if start is not None and end is not None and len(timed) >= 2:
        pad = timedelta(hours=3)
        lo, hi = start - pad, end + pad
        gaps = []
        for (t0, _), (t1, _) in zip(timed, timed[1:]):
            if t1 < lo or t0 > hi:
                continue
            gaps.append((t1 - t0).total_seconds() / 60.0)
        if gaps:
            max_gap_min = max(gaps)
    gscore = _ais_gap_score(max_gap_min)

    raw = (
        WEIGHTS["type_prior"] * tp
        + WEIGHTS["proximity"] * prox
        + WEIGHTS["time"] * tscore
        + WEIGHTS["heading"] * hscore
        + WEIGHTS["ais_gap"] * gscore
    )
    score = round(_clamp01(raw), 3)

    reasons = _reasons(
        type_key=type_key,
        distance_km=distance_km,
        hours_out=hours_out,
        used_time=(approach or {}).get("t") or used_time,
        window_ok=start is not None and end is not None,
        cog=cog,
        toward=toward,
        heading_delta=heading_delta,
        max_gap_min=max_gap_min,
    )
    components = {
        "type_prior": round(tp, 3),
        "proximity": round(prox, 3),
        "time": round(tscore, 3),
        "heading": round(hscore, 3),
        "ais_gap": round(gscore, 3),
    }
    return {"score": score, "reasons": reasons, "components": components}


def _fmt_km(value: float) -> str:
    return f"{value:.1f}" if value >= 10.0 else f"{value:.2f}"


def _fmt_hours(value: float) -> str:
    return f"{value:.1f}"


def _fmt_min(value: float) -> str:
    return f"{value:.0f}" if abs(value - round(value)) < 1e-6 else f"{value:.1f}"


def _reasons(
    *,
    type_key: str,
    distance_km: float | None,
    hours_out: float | None,
    used_time: datetime | None,
    window_ok: bool,
    cog: float | None,
    toward: float | None,
    heading_delta: float | None,
    max_gap_min: float | None,
) -> list[str]:
    type_reason = TYPE_REASONS.get(type_key, TYPE_REASONS["other"])

    if distance_km is None:
        dist_reason = "Distance unknown — no vessel or origin coordinates"
    elif distance_km >= PROXIMITY_RANGE_KM:
        dist_reason = (
            f"{_fmt_km(distance_km)} km from origin "
            f"(≥ {PROXIMITY_RANGE_KM:.0f} km, proximity 0)"
        )
    else:
        when = used_time.strftime("%H:%MZ") if used_time else "unknown time"
        dist_reason = f"Closest approach {_fmt_km(distance_km)} km from hindcast origin at {when}."

    if not window_ok:
        time_reason = "No origin window — time score not applied"
    elif used_time is None:
        time_reason = "No vessel timestamp to compare with origin window"
    elif hours_out == 0.0:
        time_reason = "Timestamp inside origin window"
    else:
        time_reason = (
            f"{_fmt_hours(hours_out)} h outside origin window "
            f"(linear decay over {TIME_DECAY_HOURS:.0f} h)"
        )

    if cog is None or toward is None:
        heading_reason = "No course-over-ground to compare with current"
    elif heading_delta is not None and heading_delta <= HEADING_ALIGN_DEG:
        heading_reason = (
            f"COG {cog:.0f}° aligns with current {toward:.0f}° "
            f"(Δ {heading_delta:.0f}° within {HEADING_ALIGN_DEG:.0f}°)"
        )
    else:
        heading_reason = (
            f"COG {cog:.0f}° vs current toward {toward:.0f}° "
            f"(Δ {heading_delta:.0f}°)"
        )

    if max_gap_min is None:
        gap_reason = "No consecutive AIS points near origin"
    elif max_gap_min > AIS_GAP_FULL_MIN:
        gap_reason = (
            f"Max AIS gap {_fmt_min(max_gap_min)} min near origin "
            f"(> {AIS_GAP_FULL_MIN:.0f} min dark interval)"
        )
    else:
        gap_reason = f"Max AIS gap {_fmt_min(max_gap_min)} min near origin"

    return [type_reason, dist_reason, time_reason, heading_reason, gap_reason]


def rank_vessels(
    vessels: list,
    origin: dict,
    origin_window: dict,
    current_toward_deg: float,
) -> list:
    """Score vessels and return them sorted by score descending, rank 1..n."""
    ranked: list[dict] = []
    for vessel in vessels or []:
        result = score_vessel(vessel, origin, origin_window, current_toward_deg)
        row = dict(vessel)
        row.update(result)
        ranked.append(row)

    def _tie_key(row: dict) -> str:
        ident = row.get("id", row.get("mmsi", row.get("name", "")))
        return str(ident)

    ranked.sort(key=lambda row: (-float(row["score"]), _tie_key(row)))
    for index, row in enumerate(ranked, start=1):
        row["rank"] = index
    return ranked


def _self_check() -> None:
    origin = {"lat": 18.890, "lon": 72.805}
    origin_window = {
        "start": "2024-03-01T08:00:00Z",
        "end": "2024-03-01T12:00:00Z",
    }
    toward = 90.0
    tanker = {
        "id": "tanker",
        "type": "oil_tanker",
        "lat": 18.905,
        "lon": 72.820,
        "cog": 88.0,
        "timestamp": "2024-03-01T10:00:00Z",
        "ais_points": [
            {"lat": 18.905, "lon": 72.820, "t": "2024-03-01T09:00:00Z"},
            {"lat": 18.905, "lon": 72.820, "t": "2024-03-01T10:05:00Z"},
        ],
    }
    passenger = {
        "id": "passenger",
        "type": "passenger",
        "lat": 19.200,
        "lon": 73.200,
        "cog": 10.0,
        "timestamp": "2024-03-02T10:00:00Z",
        "ais_points": [
            {"lat": 19.200, "lon": 73.200, "t": "2024-03-02T09:55:00Z"},
            {"lat": 19.200, "lon": 73.200, "t": "2024-03-02T10:00:00Z"},
        ],
    }
    ranked = rank_vessels([passenger, tanker], origin, origin_window, toward)
    ok = (
        ranked[0]["id"] == "tanker"
        and ranked[1]["id"] == "passenger"
        and ranked[0]["score"] > ranked[1]["score"]
        and ranked[0]["rank"] == 1
    )
    print("tanker > passenger:", "PASS" if ok else "FAIL")
    if not ok:
        raise SystemExit(1)


if __name__ == "__main__":
    _self_check()
