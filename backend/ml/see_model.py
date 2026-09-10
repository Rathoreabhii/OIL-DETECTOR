"""Run the trained U-Net in the terminal. Does not start the Map."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "ml"))

from config import MODELS_DIR, PROCESSED_DIR  # noqa: E402
from predict import get_trained_model, predict_mask  # noqa: E402


def _score_tile(model, name: str) -> None:
    img_p = PROCESSED_DIR / "images" / name
    mask_p = PROCESSED_DIR / "masks" / name
    sar = np.array(Image.open(img_p).convert("L"))
    gt = (np.array(Image.open(mask_p).convert("L")) > 127).astype(np.uint8)
    t = torch.from_numpy(sar.astype(np.float32) / 255.0).unsqueeze(0).unsqueeze(0)
    t = t.to("cuda" if torch.cuda.is_available() else "cpu")
    with torch.no_grad():
        pred = (torch.sigmoid(model(t).float()).squeeze().cpu().numpy() > 0.5).astype(np.uint8)
    inter = int(np.logical_and(pred, gt).sum())
    ps, gs = int(pred.sum()), int(gt.sum())
    dice = (2 * inter) / (ps + gs + 1e-9)
    print(f"  {name}")
    print(f"    human oil pixels : {gs}")
    print(f"    U-Net oil pixels : {ps}")
    print(f"    overlap          : {inter}")
    print(f"    Dice (this tile) : {dice:.3f}")


def main() -> None:
    print("=" * 60)
    print("  SIH 26143 — U-Net check (terminal only)")
    print("=" * 60)
    ck = MODELS_DIR / "oil_unet.pt"
    print(f"[*] Weights: {ck}  exists={ck.is_file()}")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[*] Device : {device.upper()}")
    if device == "cuda":
        print(f"[*] GPU    : {torch.cuda.get_device_name(0)}")

    metrics = MODELS_DIR / "oil_unet_metrics.json"
    if metrics.is_file():
        m = json.loads(metrics.read_text(encoding="utf-8"))
        print(
            f"[*] Saved val: epoch {m.get('epoch')}  Dice {float(m.get('val_dice', 0)):.3f}  "
            f"recall {float(m.get('val_recall', 0)):.3f}  prec {float(m.get('val_precision', 0)):.3f}"
        )

    model = get_trained_model()
    if model is None:
        print("[!] Could not load U-Net. Check oil_unet.pt and torch.")
        sys.exit(1)
    print("[+] Model loaded.\n")

    print("Tiles (orange-oil test vs human mask):")
    _score_tile(model, "01210_t003.png")
    _score_tile(model, "00970_t010.png")

    print("\nDemo PNG through detect_slick (same path as Upload):")
    import detect

    preview = ROOT / "data" / "demo" / "sar_preview.png"
    bounds = [[18.5, 71.7], [18.8, 72.2]]
    case_path = ROOT / "data" / "demo" / "case_001.json"
    if case_path.is_file():
        case = json.loads(case_path.read_text(encoding="utf-8"))
        bounds = (case.get("sar") or {}).get("bounds") or bounds
    out = detect.detect_slick(preview.read_bytes(), bounds)
    print(f"  file       : {preview.name}")
    print(f"  source     : {out.get('source')}")
    print(f"  confidence : {out.get('confidence')}")
    print(f"  area_km2   : {out.get('area_km2')}")
    print(f"  note       : {out.get('note')}")
    if out.get("source") == "unet-sentinel1":
        print("\n[OK] U-Net ran. source=unet-sentinel1")
    else:
        print("\n[!] Fell back to classical dark-spot. U-Net did not return a polygon.")
    print("=" * 60)


if __name__ == "__main__":
    main()
