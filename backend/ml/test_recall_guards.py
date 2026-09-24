"""Guards for the recall retrain. No GPU. No Part III."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dataset import MANIFEST_HASH, fit_pair, load_split_manifest
from part3_guard import assert_not_part3


def test_reflect_pad_keeps_edge_oil() -> None:
    img = np.zeros((8, 6), dtype=np.float32)
    mask = np.zeros((8, 6), dtype=np.float32)
    # Column 4 is reflected into the pad (numpy reflect does not copy the last pixel).
    img[:, 4] = 0.25
    mask[:, 4] = 1.0
    out_img, out_mask = fit_pair(img, mask, 8, 8)
    assert out_img.shape == (8, 8)
    assert out_mask.shape == (8, 8)
    assert int(out_mask[:, 6].sum()) == 8, "reflected oil was erased"
    assert float(out_img[:, 6].min()) > 0.0


def test_manifest_is_disjoint_and_hashed() -> None:
    roles = load_split_manifest()
    assert set(roles) == {"train", "model_val", "calibration"}
    groups = {key: set(values) for key, values in roles.items()}
    assert not (groups["train"] & groups["model_val"])
    assert not (groups["train"] & groups["calibration"])
    assert not (groups["model_val"] & groups["calibration"])
    assert len(groups["train"]) == 1565
    assert len(groups["model_val"]) == 335
    assert len(groups["calibration"]) == 335
    assert MANIFEST_HASH == "40b2b45dd2e0"
    assert_not_part3(Path(r"E:\oil detector\data\processed_512\images"), role="tiles")


def test_part3_manifest_path_rejected() -> None:
    from part3_guard import Part3ForbiddenError, is_part3_path

    assert is_part3_path(r"E:\oil detector\data\zenodo\Images\Oil\x.tif")
    try:
        assert_not_part3(r"E:\oil detector\data\zenodo\Images\Oil\x.tif", role="image")
    except Part3ForbiddenError:
        return
    raise AssertionError("Part III path was accepted")


if __name__ == "__main__":
    tests = [
        test_reflect_pad_keeps_edge_oil,
        test_manifest_is_disjoint_and_hashed,
        test_part3_manifest_path_rejected,
    ]
    for fn in tests:
        fn()
        print("ok", fn.__name__)
    print(f"all {len(tests)} recall-guard tests passed")
