"""CPU tests for pad/stitch/hysteresis. No Part III. No trained weights required."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from part3_guard import Part3ForbiddenError, assert_not_part3, is_part3_path
from predict import (
    TILE_SIZE,
    apply_hysteresis,
    axis_tile_starts,
    gaussian_tile_weight,
    pad_for_tiles,
    predict_mask,
)


class _ConstModel:
    def __init__(self, logit: float) -> None:
        self.logit = logit

    def __call__(self, tensor: torch.Tensor) -> torch.Tensor:
        n, _, h, w = tensor.shape
        return torch.full((n, 1, h, w), self.logit, dtype=torch.float32)


def test_pad_short_axis_keeps_long_axis() -> None:
    arr = np.zeros((400, 2000), dtype=np.float32)
    padded, h0, w0 = pad_for_tiles(arr, 512)
    assert (h0, w0) == (400, 2000)
    assert padded.shape == (512, 2000)


def test_output_shape_nonsquare() -> None:
    model = _ConstModel(0.0)
    img = (np.random.RandomState(0).rand(400, 2000) * 255).astype(np.uint8)
    mask = predict_mask(img, model, use_tta=False, use_postprocess=False, overlap=128)
    assert mask.shape == (400, 2000)


def test_gaussian_positive() -> None:
    w = gaussian_tile_weight(512, 0.25)
    assert w.shape == (512, 512)
    assert float(w.min()) > 0.0
    assert w[256, 256] > w[0, 0]


def test_axis_starts_cover_end() -> None:
    starts = axis_tile_starts(2000, 512, 384)
    assert starts[0] == 0
    assert starts[-1] == 2000 - 512


def test_hysteresis_keeps_weak_tail() -> None:
    probs = np.zeros((32, 32), dtype=np.float32)
    probs[8:12, 8:12] = 0.8
    probs[11:20, 11] = 0.25
    out = apply_hysteresis(probs, 0.20, 0.45)
    assert out[9, 9] == 1
    assert out[15, 11] == 1


def test_hysteresis_drops_weak_only() -> None:
    probs = np.zeros((32, 32), dtype=np.float32)
    probs[20:24, 20:24] = 0.25
    out = apply_hysteresis(probs, 0.20, 0.45)
    assert int(out.sum()) == 0


def test_part3_paths_rejected() -> None:
    assert is_part3_path(r"E:\oil detector\data\zenodo\Images\Oil\x.tif")
    assert is_part3_path(r"E:\oil detector\data\zenodo\Mask\Lookalike\x.tif")
    assert not is_part3_path(r"E:\oil detector\data\zenodo\Lookalike\x.tif")
    assert not is_part3_path(r"E:\oil detector\data\zenodo\01_Train_Val_Oil_Spill_images\Oil\x.tif")
    try:
        assert_not_part3(r"E:\oil detector\data\zenodo\Images\No oil\x.tif")
    except Part3ForbiddenError:
        return
    raise AssertionError("Part III path was not rejected")


def test_dark_rim_grows_only_into_dark_neighbors():
    from predict import grow_dark_rim

    img = np.full((32, 32), 180, np.uint8)
    img[10:14, 8:12] = 0
    img[10:14, 12:18] = 40
    probs = np.zeros((32, 32), np.float32)
    probs[10:14, 8:12] = 0.9
    core = probs >= 0.45
    grown = grow_dark_rim(img, probs, core, radius=8, gap=50)
    assert grown[11, 9] == 1
    assert grown[11, 15] == 1
    assert grown[11, 24] == 0
    assert grown[2, 2] == 0


if __name__ == "__main__":
    tests = [
        test_pad_short_axis_keeps_long_axis,
        test_output_shape_nonsquare,
        test_gaussian_positive,
        test_axis_starts_cover_end,
        test_hysteresis_keeps_weak_tail,
        test_hysteresis_drops_weak_only,
        test_part3_paths_rejected,
        test_dark_rim_grows_only_into_dark_neighbors,
    ]
    for fn in tests:
        fn()
        print("ok", fn.__name__)
    print(f"TILE_SIZE={TILE_SIZE} all {len(tests)} tests passed")
