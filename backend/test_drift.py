"""Stdlib checks for leeway oil drift."""

from __future__ import annotations

import math
import unittest

from drift import (
    KM_PER_DEG_LAT,
    WIND_FACTOR,
    forecast,
    hindcast,
    leeway_velocity_ms,
    origin_window_iso,
    step_latlon,
)


class VelocityTests(unittest.TestCase):
    def test_east_current_only(self):
        ve, vn = leeway_velocity_ms(
            {"speed_ms": 0.0, "toward_deg": 90.0},
            {"speed_ms": 1.0, "toward_deg": 0.0},
        )
        self.assertAlmostEqual(ve, 1.0, places=9)
        self.assertAlmostEqual(vn, 0.0, places=9)

    def test_south_is_90(self):
        ve, vn = leeway_velocity_ms(
            {"speed_ms": 0.0, "toward_deg": 0.0},
            {"speed_ms": 2.0, "toward_deg": 90.0},
        )
        self.assertAlmostEqual(ve, 0.0, places=9)
        self.assertAlmostEqual(vn, -2.0, places=9)

    def test_wind_factor(self):
        ve, vn = leeway_velocity_ms(
            {"speed_ms": 10.0, "toward_deg": 0.0},
            {"speed_ms": 0.0, "toward_deg": 0.0},
        )
        self.assertAlmostEqual(ve, 10.0 * WIND_FACTOR, places=9)
        self.assertAlmostEqual(vn, 0.0, places=9)

    def test_ignores_from_deg(self):
        ve, vn = leeway_velocity_ms(
            {"speed_ms": 10.0, "from_deg": 180.0, "toward_deg": 0.0},
            {"speed_ms": 0.0, "from_deg": 90.0, "toward_deg": 0.0},
        )
        self.assertAlmostEqual(ve, 10.0 * WIND_FACTOR, places=9)
        self.assertAlmostEqual(vn, 0.0, places=9)


class StepTests(unittest.TestCase):
    def test_east_one_hour_moves_lon_positive(self):
        lat, lon = step_latlon(0.0, 0.0, 1.0, 0.0, 1.0)
        self.assertEqual(lat, 0.0)
        self.assertGreater(lon, 0.0)
        self.assertAlmostEqual(lon, 3.6 / KM_PER_DEG_LAT, places=9)

    def test_north_one_hour_moves_lat_positive(self):
        lat, lon = step_latlon(18.0, 72.0, 0.0, 1.0, 1.0)
        self.assertGreater(lat, 18.0)
        self.assertAlmostEqual(lon, 72.0, places=9)
        self.assertAlmostEqual(lat, 18.0 + 3.6 / KM_PER_DEG_LAT, places=9)

    def test_lon_uses_cos_lat(self):
        lat0 = 18.668
        _, lon = step_latlon(lat0, 72.0, 1.0, 0.0, 1.0)
        expected = 72.0 + 3.6 / (KM_PER_DEG_LAT * math.cos(math.radians(lat0)))
        self.assertAlmostEqual(lon, expected, places=9)


class PathTests(unittest.TestCase):
    def test_hindcast_goes_backward_from_zero(self):
        pts = hindcast(
            18.668,
            72.048,
            {"speed_ms": 0.0, "toward_deg": 0.0},
            {"speed_ms": 1.0, "toward_deg": 0.0},
            hours=16,
            step_h=2,
        )
        times = [p["t_hours"] for p in pts]
        self.assertEqual(times[0], 0.0)
        self.assertEqual(times[-1], -16.0)
        self.assertEqual(times, [0.0, -2.0, -4.0, -6.0, -8.0, -10.0, -12.0, -14.0, -16.0])
        self.assertEqual(pts[0]["lon"], 72.048)
        self.assertLess(pts[-1]["lon"], pts[0]["lon"])

    def test_forecast_goes_forward_from_zero(self):
        pts = forecast(
            18.668,
            72.048,
            {"speed_ms": 0.0, "toward_deg": 0.0},
            {"speed_ms": 1.0, "toward_deg": 0.0},
            hours=16,
            step_h=2,
        )
        times = [p["t_hours"] for p in pts]
        self.assertEqual(times[0], 0.0)
        self.assertEqual(times[-1], 16.0)
        self.assertGreater(pts[-1]["lon"], pts[0]["lon"])

    def test_leeway_plus_step_matches_self_check(self):
        ve, vn = leeway_velocity_ms(
            {"speed_ms": 0.0, "toward_deg": 0.0},
            {"speed_ms": 1.0, "toward_deg": 0.0},
        )
        _, lon = step_latlon(0.0, 0.0, ve, vn, 1.0)
        self.assertGreater(lon, 0.0)


class OriginWindowTests(unittest.TestCase):
    def test_centered_on_observed_minus_age(self):
        window = origin_window_iso("2025-11-18T06:42:11Z", 16.0, half_width_h=3)
        self.assertEqual(window["start"], "2025-11-17T11:42:11Z")
        self.assertEqual(window["end"], "2025-11-17T17:42:11Z")


if __name__ == "__main__":
    unittest.main()
