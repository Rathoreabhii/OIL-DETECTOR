"""Append lookalike + no-oil 512 tiles. Does NOT wipe Part 1 oil PNGs.

16 GB RAM: one 2048x2048x2 scene at a time, then gc.
8 GB GPU: unused here (CPU/disk only).
"""
from __future__ import annotations

import gc
import random
import sys
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image
from tqdm import tqdm

from config import (
    DATA_DIR,
    PART2_KEEP_LOOK,
    PART2_KEEP_NOIL,
    PART2_LOOK_SCENES,
    PART2_NOIL_SCENES,
    PROCESSED_DIR,
    SAR_POL_INDEX,
    SEED,
    TILE_SIZE,
    OVERLAP,
)
from trim_and_tile import convert_32bit_to_8bit

random.seed(SEED)
np.random.seed(SEED)


def _pairs(img_dir: Path, mask_dir: Path) -> list[tuple[Path, Path]]:
    mask_map = {m.stem: m for m in mask_dir.glob("*.tif*")}
    out = []
    for img_p in sorted(img_dir.glob("*.tif*")):
        m = mask_map.get(img_p.stem)
        if m is not None:
            out.append((img_p, m))
    return out


def _oil_positive_count(mask_dir: Path) -> int:
    n = 0
    for p in mask_dir.glob("*.png"):
        name = p.name
        if name.startswith("look_") or name.startswith("noil_"):
            continue
        n += 1
    return n


def _tile_family(
    pairs: list[tuple[Path, Path]],
    prefix: str,
    max_scenes: int,
    keep_ratio: float,
    out_img: Path,
    out_mask: Path,
    budget: int,
) -> int:
    def _starts(length: int) -> list[int]:
        if length <= TILE_SIZE:
            return [0]
        s = list(range(0, length - TILE_SIZE + 1, step))
        last = length - TILE_SIZE
        if last not in s:
            s.append(last)
        return s

    rng = random.Random(SEED + (1 if prefix.startswith("look") else 2))
    shuffled = pairs[:]
    rng.shuffle(shuffled)
    selected = shuffled[:max_scenes]
    step = TILE_SIZE - OVERLAP
    saved = 0
    pbar = tqdm(selected, desc=f"Tiles {prefix}")
    for img_p, mask_p in pbar:
        if saved >= budget:
            break
        # Append-only: skip stems already tiled.
        if any(out_img.glob(f"{prefix}{img_p.stem}_t*.png")):
            continue
        try:
            raw = tifffile.imread(str(img_p))
            img_8 = convert_32bit_to_8bit(raw)
            del raw
            raw_m = tifffile.imread(str(mask_p))
            if raw_m.ndim == 3:
                raw_m = raw_m[:, :, 0]
            mask_8 = np.where(raw_m > 0, 255, 0).astype(np.uint8)
            del raw_m
            h, w = img_8.shape[:2]
            tile_idx = 0
            for y in _starts(h):
                for x in _starts(w):
                    if saved >= budget:
                        break
                    t_img = img_8[y : y + TILE_SIZE, x : x + TILE_SIZE]
                    t_msk = mask_8[y : y + TILE_SIZE, x : x + TILE_SIZE]
                    oil_px = int(np.sum(t_msk > 0))
                    keep = oil_px >= 100 or rng.random() < keep_ratio
                    if keep:
                        tname = f"{prefix}{img_p.stem}_t{tile_idx:03d}.png"
                        Image.fromarray(t_img).save(out_img / tname, optimize=True)
                        Image.fromarray(t_msk).save(out_mask / tname, optimize=True)
                        saved += 1
                    tile_idx += 1
            del img_8, mask_8
            gc.collect()
            pbar.set_postfix({"saved": saved})
        except Exception as exc:
            print(f"[!] {prefix}{img_p.name}: {exc}")
            gc.collect()
    return saved


def main() -> None:
    zen = DATA_DIR / "zenodo"
    look_img = zen / "Lookalike"
    look_m = zen / "01_Train_Val_Lookalike_mask" / "Mask_lookalike"
    noil_img = zen / "No_oil"
    noil_m = zen / "01_Train_Val_No_Oil_mask" / "Mask_no_oil"
    out_img = PROCESSED_DIR / "images"
    out_mask = PROCESSED_DIR / "masks"
    if not out_img.exists() or not any(out_img.glob("*.png")):
        raise SystemExit("No Part 1 oil tiles. Do not wipe; run oil tiler first.")

    oil_n = _oil_positive_count(out_mask)
    budget_total = oil_n  # look+noil tiles <= oil tiles
    budget_look = int(budget_total * 0.75)
    budget_noil = budget_total - budget_look
    print("=" * 60)
    print("Part 2 append-only tiler (no wipe)")
    print(f"  RAM rule: one scene, then gc. GPU unused.")
    print(f"  Existing oil-family tiles: {oil_n}")
    print(f"  Lookalike budget: {budget_look}  no-oil budget: {budget_noil}")
    print("=" * 60)

    n_look = _tile_family(
        _pairs(look_img, look_m),
        "look_",
        PART2_LOOK_SCENES,
        PART2_KEEP_LOOK,
        out_img,
        out_mask,
        budget_look,
    )
    n_noil = _tile_family(
        _pairs(noil_img, noil_m),
        "noil_",
        PART2_NOIL_SCENES,
        PART2_KEEP_NOIL,
        out_img,
        out_mask,
        budget_noil,
    )
    print(f"[OK] appended look={n_look} noil={n_noil}  oil_family_kept={oil_n}")


if __name__ == "__main__":
    main()
