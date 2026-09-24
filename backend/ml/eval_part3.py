"""Score frozen oil_unet.pt on Zenodo Part III. TEST ONLY.

Do not train on these scenes. Do not sweep thresholds here. Do not pass
operating-point overrides. After viewing a result, stop — further changes go
through Part 1/2 calibration (`calibrate.py`), then this script once.
"""
from __future__ import annotations

import gc
import json
import sys
from pathlib import Path

import numpy as np
import tifffile
import torch
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "ml"))

from config import SAR_POL_INDEX, TILE_SIZE  # noqa: E402
from predict import get_trained_model, predict_mask  # noqa: E402
from trim_and_tile import convert_32bit_to_8bit  # noqa: E402

Z = ROOT / "data" / "zenodo"
IMG = Z / "Images"
MSK = Z / "Mask"
OUT = ROOT / "data" / "processed_512_test"


def pair(kind: str) -> list[tuple[Path, Path]]:
    idir, mdir = IMG / kind, MSK / kind
    mm = {}
    for p in mdir.glob("*.tif*"):
        key = p.stem.replace("_segmentation", "")
        mm[key] = p
        mm[p.stem] = p
    out = []
    for ip in sorted(idir.glob("*.tif*")):
        mp = mm.get(ip.stem) or mm.get(ip.stem + "_segmentation")
        if mp:
            out.append((ip, mp))
    return out


def score_split(name: str, pairs: list[tuple[Path, Path]], model) -> dict:
    tp = fp = fn = 0
    nonempty = 0
    pred_any = 0
    for i, (ip, mp) in enumerate(pairs):
        raw = tifffile.imread(str(ip))
        img = convert_32bit_to_8bit(raw)
        del raw
        m = np.array(Image.open(mp))
        if m.ndim == 3:
            m = m[:, :, 0]
        gt = (m > 0).astype(np.uint8)
        # Enhanced pipeline: TTA + lower threshold + morph closing + blob filter
        pred = predict_mask(img, model)  # frozen defaults; no Part-3 overrides
        if pred.shape != gt.shape:
            raise ValueError(
                f"prediction/mask shape mismatch for {ip.name}: "
                f"pred {pred.shape} vs gt {gt.shape}"
            )
        inter = int(np.logical_and(pred, gt).sum())
        ps, gs = int(pred.sum()), int(gt.sum())
        tp += inter
        fp += ps - inter
        fn += gs - inter
        if gs:
            nonempty += 1
        if ps:
            pred_any += 1
        del img, pred, gt
        gc.collect()
        if (i + 1) % 25 == 0:
            print(f"  {name} {i+1}/{len(pairs)}", flush=True)
    rec = tp / (tp + fn + 1e-9)
    prec = tp / (tp + fp + 1e-9)
    dice = (2 * tp) / (2 * tp + fp + fn + 1e-9)
    return {
        "n": len(pairs),
        "nonempty_gt": nonempty,
        "scenes_with_pred_oil": pred_any,
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "recall": rec,
        "precision": prec,
        "dice": dice,
        "false_oil_scenes": pred_any if nonempty == 0 else None,
    }


def main() -> None:
    if len(sys.argv) > 1:
        raise SystemExit(
            "eval_part3.py accepts no arguments. Part III is a frozen test set; "
            "do not pass thresholds or morphology overrides. Calibrate on Part 1/2."
        )
    print("Part III test — frozen U-Net, no training, no operating-point overrides")
    print("Expect folders:", IMG, MSK)
    for k in ("Oil", "Lookalike", "No oil"):
        print(f"  {k}: img={len(list((IMG/k).glob('*.tif*')))} mask={len(list((MSK/k).glob('*.tif*')))}")
    model = get_trained_model()
    if model is None:
        raise SystemExit("Could not load oil_unet.pt")
    report = {}
    for kind, key in (("Oil", "oil"), ("Lookalike", "lookalike"), ("No oil", "no_oil")):
        pairs = pair(kind)
        print(f"\n=== {kind} n={len(pairs)} ===", flush=True)
        report[key] = score_split(key, pairs, model)
        print(json.dumps(report[key], indent=2), flush=True)
    out = ROOT / "backend" / "models" / "oil_unet_part3_test.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("\nWrote", out)


if __name__ == "__main__":
    main()
