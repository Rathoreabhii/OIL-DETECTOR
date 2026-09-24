"""Calibrate operating point on Part 1/2 val FULL scenes. Never reads Part III.

Default is --dry-run (list scenes, refuse Part 3 paths). Pass --run to sweep
on GPU. This script does not write into eval_part3.py or retune from Part 3.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "backend" / "ml"))

from config import DATA_DIR, MODELS_DIR  # noqa: E402
from dataset import _family, load_split_manifest  # noqa: E402
from part3_guard import Part3ForbiddenError, assert_not_part3, is_part3_path  # noqa: E402

Z = DATA_DIR / "zenodo"
PART3_IMAGES = Z / "Images"
OUT = MODELS_DIR / "calibration_manifest.json"

# Candidate grid is small on purpose (laptop). Expand only on Part 1/2.
SINGLE_THRESHOLDS = (0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45)
HYSTERESIS = ((0.15, 0.35), (0.15, 0.40), (0.20, 0.40), (0.20, 0.45), (0.25, 0.45))
MIN_BLOBS = (200, 450)
PRECISION_FLOOR = 0.85


def _first_existing(candidates: list[Path]) -> Path | None:
    for path in candidates:
        if path.is_file():
            return path
    return None


def oil_stem(scene_id: str) -> str:
    return scene_id


def look_stem(scene_id: str) -> str:
    return scene_id[5:] if scene_id.startswith("look_") else scene_id


def noil_stem(scene_id: str) -> str:
    return scene_id[5:] if scene_id.startswith("noil_") else scene_id


def resolve_pair(family: str, sid: str) -> tuple[Path, Path]:
    if family == "oil":
        stem = oil_stem(sid)
        img = _first_existing(
            [
                Z / "01_Train_Val_Oil_Spill_images" / "Oil" / f"{stem}.tif",
                Z / "01_Train_Val_Oil_Spill_images" / "Oil" / f"{stem}.tiff",
            ]
        )
        msk = _first_existing(
            [
                Z / "masks" / "Mask_oil" / f"{stem}.tif",
                Z / "masks" / f"{stem}.tif",
                Z / "masks" / f"{stem}_segmentation.tif",
            ]
        )
    elif family == "look":
        stem = look_stem(sid)
        img = _first_existing(
            [
                Z / "Lookalike" / f"{stem}.tif",
                Z / "Lookalike" / f"{stem}.tiff",
            ]
        )
        msk = _first_existing(
            [
                Z / "01_Train_Val_Lookalike_mask" / "Mask_lookalike" / f"{stem}.tif",
                Z / "Mask_lookalike" / f"{stem}.tif",
            ]
        )
    elif family == "noil":
        stem = noil_stem(sid)
        img = _first_existing(
            [
                Z / "No_oil" / f"{stem}.tif",
                Z / "No_oil" / f"{stem}.tiff",
            ]
        )
        msk = _first_existing(
            [
                Z / "01_Train_Val_No_Oil_mask" / "Mask_no_oil" / f"{stem}.tif",
                Z / "01_Train_Val_No_Oil_mask" / f"{stem}.tif",
            ]
        )
    else:
        raise ValueError(f"unknown family {family}")
    if img is None or msk is None:
        raise FileNotFoundError(f"missing Part 1/2 pair for {family} scene {sid}")
    assert_not_part3(img, role=f"{family} image")
    assert_not_part3(msk, role=f"{family} mask")
    return img, msk


def try_resolve_pair(family: str, sid: str) -> tuple[Path, Path] | None:
    try:
        return resolve_pair(family, sid)
    except FileNotFoundError:
        return None


def list_calibration_scenes() -> list[dict[str, str]]:
    """Manifest calibration scenes only. These are not the training scenes and not Part III."""
    roles = load_split_manifest()
    rows: list[dict[str, str]] = []
    missing = 0
    oil_listed = 0
    for sid in roles["calibration"]:
        family = _family(sid)
        if family == "oil":
            oil_listed += 1
        pair = try_resolve_pair(family, sid)
        if pair is None:
            missing += 1
            continue
        img, msk = pair
        rows.append(
            {
                "family": family,
                "scene_id": sid,
                "image": str(img),
                "mask": str(msk),
            }
        )
    oil_found = sum(1 for row in rows if row["family"] == "oil")
    if missing:
        print(f"[!] skipped {missing} calibration scenes with no Part 1/2 TIFF pair on disk")
    if oil_listed and oil_found < int(0.95 * oil_listed):
        raise SystemExit(f"only {oil_found}/{oil_listed} oil calibration scenes resolved")
    if not rows:
        raise SystemExit("no Part 1/2 calibration scenes resolved")
    return rows


def oil_boundary(gt) -> "np.ndarray":
    import cv2
    import numpy as np

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    eroded = cv2.erode(gt, kernel, iterations=1)
    return ((gt > 0) & (eroded == 0)).astype(np.uint8)


def _metrics(tp: int, fp: int, fn: int) -> dict[str, float | None]:
    rec = tp / (tp + fn) if (tp + fn) else None
    prec = tp / (tp + fp) if (tp + fp) else None
    dice = (2 * tp) / (2 * tp + fp + fn) if (2 * tp + fp + fn) else None
    return {"recall": rec, "precision": prec, "dice": dice}


def run_sweep(rows: list[dict[str, str]], max_per_family: int, checkpoint: Path | None = None) -> dict:
    import gc

    import numpy as np
    import tifffile
    from PIL import Image

    from predict import (
        _morphological_close,
        _remove_small_blobs,
        apply_hysteresis,
        load_weights,
        predict_mask,
    )
    from trim_and_tile import convert_32bit_to_8bit

    model = load_weights(checkpoint) if checkpoint else load_weights(MODELS_DIR / "oil_unet.pt")
    if model is None:
        raise SystemExit(f"could not load checkpoint {checkpoint or MODELS_DIR / 'oil_unet.pt'}")

    capped: dict[str, list[dict[str, str]]] = {"oil": [], "look": [], "noil": []}
    for row in rows:
        bucket = capped[row["family"]]
        if len(bucket) < max_per_family:
            bucket.append(row)
    used = capped["oil"] + capped["look"] + capped["noil"]

    # Cache probability maps once (frozen checkpoint + gaussian stitch + TTA).
    # float16 keeps a full calibration list inside 16 GB RAM.
    cached: list[tuple] = []
    for i, row in enumerate(used):
        print(f"prob {i + 1}/{len(used)} {row['family']} {row['scene_id']}", flush=True)
        raw = tifffile.imread(row["image"])
        img = convert_32bit_to_8bit(raw)
        del raw
        if row["family"] == "oil":
            m = np.array(Image.open(row["mask"]))
            if m.ndim == 3:
                m = m[:, :, 0]
            gt = (m > 0).astype(np.uint8)
            boundary = oil_boundary(gt)
            del m
        else:
            # Lookalike / No-oil scenes have NO oil ground truth
            gt = np.zeros(img.shape[:2], dtype=np.uint8)
            boundary = None
        _, probs = predict_mask(img, model, return_prob=True, use_postprocess=False)
        if probs.shape != gt.shape:
            raise ValueError(f"shape mismatch {row['scene_id']}: {probs.shape} vs {gt.shape}")
        cached.append((row["family"], probs.astype(np.float16), gt, boundary))
        del img, probs
        gc.collect()

    candidates = []
    for thr in SINGLE_THRESHOLDS:
        candidates.append({"mode": "single", "threshold": thr, "low": None, "high": None})
    for low, high in HYSTERESIS:
        candidates.append({"mode": "hysteresis", "threshold": None, "low": low, "high": high})

    reports = []
    for cand in candidates:
        for blob in MIN_BLOBS:
            oil_tp = oil_fp = oil_fn = 0
            bound_tp = bound_fn = 0
            look_fa = noil_fa = 0
            look_n = noil_n = 0
            look_fp_px = noil_fp_px = 0
            for family, probs16, gt, boundary in cached:
                probs = probs16.astype(np.float32)
                if cand["mode"] == "hysteresis":
                    mask = apply_hysteresis(probs, cand["low"], cand["high"])
                else:
                    mask = (probs > cand["threshold"]).astype(np.uint8)
                if mask.any():
                    mask = _morphological_close(mask)
                    mask = _remove_small_blobs(mask, min_px=blob)
                ps = int(mask.sum())
                if family == "oil":
                    inter = int((mask.astype(bool) & gt.astype(bool)).sum())
                    gs = int(gt.sum())
                    oil_tp += inter
                    oil_fp += ps - inter
                    oil_fn += gs - inter
                    if boundary is not None:
                        bsum = int(boundary.sum())
                        bhit = int((mask.astype(bool) & boundary.astype(bool)).sum())
                        bound_tp += bhit
                        bound_fn += bsum - bhit
                elif family == "look":
                    look_n += 1
                    look_fp_px += ps
                    if ps:
                        look_fa += 1
                elif family == "noil":
                    noil_n += 1
                    noil_fp_px += ps
                    if ps:
                        noil_fa += 1
            oil_m = _metrics(oil_tp, oil_fp, oil_fn)
            total_fp = oil_fp + look_fp_px + noil_fp_px
            pooled_prec = oil_tp / (oil_tp + total_fp) if (oil_tp + total_fp) else 0.0
            boundary_recall = bound_tp / (bound_tp + bound_fn) if (bound_tp + bound_fn) else None
            reports.append(
                {
                    **cand,
                    "min_blob_px": blob,
                    "tp": oil_tp,
                    "fp": oil_fp,
                    "fn": oil_fn,
                    **oil_m,
                    "oil_precision": oil_m["precision"],
                    "combined_fp": total_fp,
                    "combined_precision": round(pooled_prec, 4),
                    "pooled_precision": round(pooled_prec, 4),
                    "boundary_tp": bound_tp,
                    "boundary_fn": bound_fn,
                    "boundary_recall": boundary_recall,
                    "lookalike_false_scenes": look_fa,
                    "lookalike_n": look_n,
                    "no_oil_false_scenes": noil_fa,
                    "no_oil_n": noil_n,
                    "meets_precision_floor": pooled_prec >= PRECISION_FLOOR,
                }
            )

    feasible = [r for r in reports if r["meets_precision_floor"] and r["recall"] is not None]
    selected = None
    if feasible:
        feasible.sort(
            key=lambda r: (
                -(r["boundary_recall"] if r["boundary_recall"] is not None else -1.0),
                -r["recall"],
                -(r["pooled_precision"] or 0.0),
                r["lookalike_false_scenes"] + r["no_oil_false_scenes"],
                r["min_blob_px"],
            )
        )
        selected = feasible[0]
    return {
        "precision_floor": PRECISION_FLOOR,
        "precision_floor_means": "pooled oil TP / (oil TP + false pixels on oil, lookalike, and clean scenes)",
        "note": (
            "Calibration used manifest calibration scenes only. Part III was not read. "
            "The 0.85 floor is pooled precision, not oil-scene precision. "
            "If no candidate meets it, do not silently lower it and do not run Part III."
        ),
        "n_scenes": {k: len(v) for k, v in capped.items()},
        "selected": selected,
        "candidates": reports,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Part 1/2 calibration (Part III forbidden)")
    parser.add_argument("--run", action="store_true", help="sweep on GPU; default is dry-run")
    parser.add_argument("--dry-run", action="store_true", help="list manifest calibration scenes only (default)")
    parser.add_argument("--checkpoint", type=str, default="", help="weights to score; default oil_unet.pt")
    parser.add_argument("--out", type=str, default="", help="json path; default calibration_manifest.json")
    parser.add_argument("--max-per-family", type=int, default=0, help="cap scenes per family; 0 means every calibration scene")
    args = parser.parse_args()

    print("Part III path (forbidden):", PART3_IMAGES)
    rows = list_calibration_scenes()
    print(f"calibration scenes resolved: {len(rows)} (manifest calibration, Part 1/2 only)")
    for row in rows:
        if is_part3_path(row["image"]) or is_part3_path(row["mask"]):
            raise Part3ForbiddenError(row)

    if args.dry_run and args.run:
        raise SystemExit("pass only one of --dry-run or --run")
    if not args.run:
        by = {"oil": 0, "look": 0, "noil": 0}
        for row in rows:
            by[row["family"]] += 1
        print("dry-run counts:", by)
        print("Pass --run to sweep. This will not touch Part III.")
        return

    cap = len(rows) if args.max_per_family <= 0 else args.max_per_family
    checkpoint = Path(args.checkpoint) if args.checkpoint else None
    report = run_sweep(rows, cap, checkpoint)
    report["checkpoint"] = str(checkpoint or (MODELS_DIR / "oil_unet.pt"))
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    out = Path(args.out) if args.out else OUT
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("Wrote", out)
    print("selected:", json.dumps(report.get("selected"), indent=2))
    if report.get("selected") is None:
        print("No candidate met pooled precision floor", PRECISION_FLOOR, "- not freezing.")


if __name__ == "__main__":
    main()
