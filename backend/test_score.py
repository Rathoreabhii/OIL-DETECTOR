"""Stdlib checks for explainable vessel ranking."""

from __future__ import annotations

import unittest

from score import (
    AIS_GAP_FULL_MIN,
    TYPE_PRIOR,
    rank_vessels,
    score_vessel,
    type_prior,
)


ORIGIN = {"lat": 18.890, "lon": 72.805}
WINDOW = {"start": "2024-03-01T08:00:00Z", "end": "2024-03-01T12:00:00Z"}
TOWARD = 90.0


def _vessel(**overrides):
    base = {
        "id": "v",
        "type": "cargo",
        "lat": 18.890,
        "lon": 72.805,
        "cog": 90.0,
        "timestamp": "2024-03-01T10:00:00Z",
        "ais_points": [
            {"lat": 18.890, "lon": 72.805, "t": "2024-03-01T09:30:00Z"},
            {"lat": 18.890, "lon": 72.805, "t": "2024-03-01T10:00:00Z"},
        ],
    }
    base.update(overrides)
    return base


class TypePriorTests(unittest.TestCase):
    def test_table_values(self):
        for key, value in TYPE_PRIOR.items():
            self.assertEqual(type_prior(key), value)

    def test_alias_and_unknown(self):
        self.assertEqual(type_prior("Oil Tanker"), 1.00)
        self.assertEqual(type_prior("ferry"), 0.15)
        self.assertEqual(type_prior("mystery barge"), TYPE_PRIOR["other"])
        self.assertEqual(type_prior(80), 1.00)
        self.assertEqual(type_prior(30), 0.25)


class ComponentTests(unittest.TestCase):
    def test_proximity_linear(self):
        at_origin = score_vessel(_vessel(), ORIGIN, WINDOW, TOWARD)
        self.assertEqual(at_origin["components"]["proximity"], 1.0)

        far = _vessel(id="far", lat=18.890, lon=73.185)  # ~40 km east
        far_score = score_vessel(far, ORIGIN, WINDOW, TOWARD)
        self.assertLessEqual(far_score["components"]["proximity"], 0.02)

    def test_time_in_window_and_decay(self):
        inside = score_vessel(_vessel(), ORIGIN, WINDOW, TOWARD)
        self.assertEqual(inside["components"]["time"], 1.0)

        late = score_vessel(
            _vessel(timestamp="2024-03-02T12:00:00Z", ais_points=[]),
            ORIGIN,
            WINDOW,
            TOWARD,
        )
        self.assertEqual(late["components"]["time"], 0.0)

    def test_heading_plateau(self):
        aligned = score_vessel(_vessel(cog=115.0), ORIGIN, WINDOW, TOWARD)
        self.assertEqual(aligned["components"]["heading"], 1.0)

        opposite = score_vessel(_vessel(cog=270.0), ORIGIN, WINDOW, TOWARD)
        self.assertEqual(opposite["components"]["heading"], 0.0)

    def test_ais_gap_scaled(self):
        dark = _vessel(
            ais_points=[
                {"lat": 18.890, "lon": 72.805, "t": "2024-03-01T09:00:00Z"},
                {"lat": 18.890, "lon": 72.805, "t": "2024-03-01T10:00:00Z"},
            ]
        )
        result = score_vessel(dark, ORIGIN, WINDOW, TOWARD)
        self.assertEqual(result["components"]["ais_gap"], 1.0)

        short = _vessel(
            ais_points=[
                {"lat": 18.890, "lon": 72.805, "t": "2024-03-01T09:45:00Z"},
                {"lat": 18.890, "lon": 72.805, "t": "2024-03-01T10:00:00Z"},
            ]
        )
        short_result = score_vessel(short, ORIGIN, WINDOW, TOWARD)
        self.assertAlmostEqual(
            short_result["components"]["ais_gap"],
            15.0 / AIS_GAP_FULL_MIN,
            places=3,
        )


class RankTests(unittest.TestCase):
    def test_tanker_ranks_above_passenger(self):
        tanker = _vessel(
            id="tanker",
            type="oil_tanker",
            cog=88.0,
            ais_points=[
                {"lat": 18.905, "lon": 72.820, "t": "2024-03-01T09:00:00Z"},
                {"lat": 18.905, "lon": 72.820, "t": "2024-03-01T10:05:00Z"},
            ],
            lat=18.905,
            lon=72.820,
        )
        passenger = _vessel(
            id="passenger",
            type="passenger",
            lat=19.200,
            lon=73.200,
            cog=10.0,
            timestamp="2024-03-02T10:00:00Z",
            ais_points=[
                {"lat": 19.200, "lon": 73.200, "t": "2024-03-02T09:55:00Z"},
                {"lat": 19.200, "lon": 73.200, "t": "2024-03-02T10:00:00Z"},
            ],
        )
        ranked = rank_vessels([passenger, tanker], ORIGIN, WINDOW, TOWARD)
        self.assertEqual(ranked[0]["id"], "tanker")
        self.assertEqual(ranked[0]["rank"], 1)
        self.assertGreater(ranked[0]["score"], ranked[1]["score"])

    def test_reasons_cover_type_distance_time_heading_gap(self):
        result = score_vessel(_vessel(type="oil_tanker"), ORIGIN, WINDOW, TOWARD)
        blob = " ".join(result["reasons"]).lower()
        self.assertTrue(any("oil tanker" in r.lower() for r in result["reasons"]))
        self.assertIn("km from origin", blob)
        self.assertIn("origin window", blob)
        self.assertIn("cog", blob)
        self.assertIn("ais gap", blob)
        self.assertEqual(len(result["reasons"]), 5)
        self.assertGreaterEqual(result["score"], 0.0)
        self.assertLessEqual(result["score"], 1.0)
        self.assertEqual(result["score"], round(result["score"], 3))

    def test_score_formula_weights(self):
        result = score_vessel(_vessel(type="oil_tanker"), ORIGIN, WINDOW, TOWARD)
        c = result["components"]
        expected = round(
            0.30 * c["type_prior"]
            + 0.30 * c["proximity"]
            + 0.20 * c["time"]
            + 0.10 * c["heading"]
            + 0.10 * c["ais_gap"],
            3,
        )
        self.assertEqual(result["score"], expected)


if __name__ == "__main__":
    unittest.main()
