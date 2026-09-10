"""Parse demo AIS CSV. Stdlib only."""

from __future__ import annotations

import csv
import io
from typing import Any


def parse_ais_csv(text: str) -> list[dict[str, Any]]:
    if not text or not text.strip():
        return []
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    fields = {name.lower().strip(): name for name in reader.fieldnames}

    def col(*names: str) -> str | None:
        for n in names:
            if n in fields:
                return fields[n]
        return None

    c_t = col("t", "time", "timestamp", "datetime")
    c_lat = col("lat", "latitude")
    c_lon = col("lon", "lng", "longitude")
    c_sog = col("sog", "speed")
    c_cog = col("cog", "heading", "course")
    c_mmsi = col("mmsi", "id")
    c_name = col("name", "ship", "vessel")
    c_type = col("type", "vessel_type", "shiptype")
    if not (c_t and c_lat and c_lon and c_mmsi):
        return []

    by: dict[str, dict[str, Any]] = {}
    for row in reader:
        mmsi = (row.get(c_mmsi) or "").strip()
        if not mmsi:
            continue
        try:
            lat = float(row[c_lat])
            lon = float(row[c_lon])
        except (KeyError, ValueError):
            continue
        rec = by.setdefault(
            mmsi,
            {
                "mmsi": mmsi,
                "name": (row.get(c_name) or mmsi).strip() if c_name else mmsi,
                "type": (row.get(c_type) or "other").strip() if c_type else "other",
                "track": [],
            },
        )
        rec["track"].append(
            {
                "t": (row.get(c_t) or "").strip(),
                "lat": lat,
                "lon": lon,
                "sog": float(row[c_sog]) if c_sog and row.get(c_sog) else 0.0,
                "cog": float(row[c_cog]) if c_cog and row.get(c_cog) else 0.0,
            }
        )
    return list(by.values())
