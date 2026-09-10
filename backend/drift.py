"""Leeway oil-slick drift for SIH 26143.

Not HYCOM. Not Navier-Stokes.
Leeway approximation, not an operational ocean model.

Transport = 100% of current + WIND_FACTOR of wind, both along toward_deg
(0 = east, 90 = south). from_deg is ignored if present.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

WIND_FACTOR = 0.03
KM_PER_DEG_LAT = 111.32


def _as_float(value: Any, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _speed_toward(vec: dict[str, Any] | None) -> tuple[float, float]:
    if not isinstance(vec, dict):
        return 0.0, 0.0
    return _as_float(vec.get("speed_ms")), _as_float(vec.get("toward_deg"))


def _east_north_ms(speed_ms: float, toward_deg: float) -> tuple[float, float]:
    rad = math.radians(toward_deg)
    # Clockwise from east: 0 east, 90 south.
    return speed_ms * math.cos(rad), -speed_ms * math.sin(rad)


def leeway_velocity_ms(wind: dict, current: dict) -> tuple[float, float]:
    """East/north surface velocity (m/s): current + 0.03 * wind."""
    wind_speed, wind_toward = _speed_toward(wind)
    current_speed, current_toward = _speed_toward(current)
    we, wn = _east_north_ms(wind_speed * WIND_FACTOR, wind_toward)
    ce, cn = _east_north_ms(current_speed, current_toward)
    return ce + we, cn + wn


def step_latlon(
    lat: float, lon: float, ve_ms: float, vn_ms: float, hours: float
) -> tuple[float, float]:
    """Advance lat/lon by a constant east/north velocity for `hours`."""
    east_km = ve_ms * hours * 3.6
    north_km = vn_ms * hours * 3.6
    dlat = north_km / KM_PER_DEG_LAT
    km_per_deg_lon = KM_PER_DEG_LAT * math.cos(math.radians(lat))
    dlon = 0.0 if abs(km_per_deg_lon) < 1e-9 else east_km / km_per_deg_lon
    return lat + dlat, lon + dlon


def _point(t_hours: float, lat: float, lon: float) -> dict[str, float]:
    return {
        "t_hours": round(float(t_hours), 6),
        "lat": round(float(lat), 6),
        "lon": round(float(lon), 6),
    }


def _track(
    centroid_lat: float,
    centroid_lon: float,
    wind: dict,
    current: dict,
    hours: float,
    step_h: float,
    sign: int,
) -> list[dict[str, float]]:
    lat = float(centroid_lat)
    lon = float(centroid_lon)
    hours = max(0.0, float(hours))
    step_h = float(step_h)
    out = [_point(0.0, lat, lon)]
    if hours <= 0.0 or step_h <= 0.0:
        return out
    ve, vn = leeway_velocity_ms(wind, current)
    t = 0.0
    while t + 1e-9 < hours:
        dt = min(step_h, hours - t)
        lat, lon = step_latlon(lat, lon, sign * ve, sign * vn, dt)
        t += dt
        out.append(_point(sign * t, lat, lon))
    return out


def hindcast(
    centroid_lat: float,
    centroid_lon: float,
    wind: dict,
    current: dict,
    hours: float = 16,
    step_h: float = 2,
) -> list[dict[str, float]]:
    """Slick positions from t=-hours (source) to t=0 (observation)."""
    pts = _track(centroid_lat, centroid_lon, wind, current, hours, step_h, sign=-1)
    return sorted(pts, key=lambda p: p["t_hours"])


def forecast(
    centroid_lat: float,
    centroid_lon: float,
    wind: dict,
    current: dict,
    hours: float = 16,
    step_h: float = 2,
) -> list[dict[str, float]]:
    """Slick positions from t=0 forward to t=+hours (along the leeway vector)."""
    return _track(centroid_lat, centroid_lon, wind, current, hours, step_h, sign=1)


def _parse_iso(observed_at_iso: str) -> datetime:
    text = str(observed_at_iso).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def origin_window_iso(
    observed_at_iso: str, age_hours: float, half_width_h: float = 3
) -> dict[str, str]:
    """UTC window around (observed_at - age), ± half_width_h hours."""
    observed = _parse_iso(observed_at_iso)
    origin = observed - timedelta(hours=float(age_hours))
    half = timedelta(hours=float(half_width_h))
    return {"start": _iso_z(origin - half), "end": _iso_z(origin + half)}


if __name__ == "__main__":
    wind0 = {"speed_ms": 0.0, "toward_deg": 0.0}
    current_east = {"speed_ms": 1.0, "toward_deg": 0.0}
    ve, vn = leeway_velocity_ms(wind0, current_east)
    lat, lon = step_latlon(0.0, 0.0, ve, vn, 1.0)
    assert lon > 0, (lat, lon, ve, vn)
    print("ok", "lon", lon, "ve", ve, "vn", vn)
