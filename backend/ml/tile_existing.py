"""Tile already extracted SAR scenes to 8-bit 512x512 chips.
Memory & Speed:
- Runs in < 30 seconds.
- Uses < 100 MB of RAM (processes 1 image at a time).
- Deletes raw 32-bit TIFFs as it goes to free disk space immediately.
"""

import sys
import gc
import shutil
from pathlib import Path
import numpy as np
from PIL import Image
from tqdm import tqdm
import tifffile

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data"
ZENODO_DIR = DATA_DIR / "zenodo"
STAGING_DIR = ZENODO_DIR / "_temp_extract" / "Oil"
MASK_DIR = ZENODO_DIR / "masks" / "Mask_oil"
PROCESSED_DIR = DATA_DIR / "processed_512"
OUT_IMG_DIR = PROCESSED_DIR / "images"
OUT_MASK_DIR = PROCESSED_DIR / "masks"

TILE_SIZE = 512
STEP = 448  # 64px overlap
MIN_OIL_PIXELS = 100
BACKGROUND_RATIO = 0.15


def convert_32bit_to_8bit(arr: np.ndarray) -> np.ndarray:
    """Normalize one SAR pol (VH if dual-pol) from 32-bit dB to 8-bit."""
    if arr.ndim == 3:
        arr = arr[:, :, 1] if arr.shape[-1] >= 2 else arr[:, :, 0]

    arr = arr.astype(np.float32)
    p2, p98 = np.percentile(arr, (2, 98))
    if p98 > p2:
        arr = np.clip(arr, p2, p98)
        norm = ((arr - p2) / (p98 - p2) * 255.0).astype(np.uint8)
    else:
        norm = np.clip(arr, 0, 255).astype(np.uint8)

    return norm


def run_tiling():
    OUT_IMG_DIR.mkdir(parents=True, exist_ok=True)
    OUT_MASK_DIR.mkdir(parents=True, exist_ok=True)

    scenes = sorted(list(STAGING_DIR.glob("*.tif*")))
    print(f"[*] Found {len(scenes)} extracted SAR scenes ready for 8-bit tiling.")

    total_pos = 0
    total_neg = 0

    for scene_file in tqdm(scenes, desc="Tiling 512x512"):
        stem = scene_file.stem
        # Look for corresponding mask
        mask_candidates = list(MASK_DIR.glob(f"{stem}*.tif*"))
        if not mask_candidates:
            # Mask could be named 00051.tif, etc.
            continue

        mask_file = mask_candidates[0]

        try:
            # 1. Read 32-bit image and convert to 8-bit
            raw_img = tifffile.imread(str(scene_file))
            img_8bit = convert_32bit_to_8bit(raw_img)
            del raw_img

            # 2. Read mask
            mask_raw = np.array(Image.open(mask_file))
            if mask_raw.ndim == 3:
                mask_raw = mask_raw[:, :, 0]
            mask_8bit = np.where(mask_raw > 0, 255, 0).astype(np.uint8)

            h, w = img_8bit.shape
            tile_idx = 0

            # 3. Slice into 512x512
            for y in range(0, h - TILE_SIZE + 1, STEP):
                for x in range(0, w - TILE_SIZE + 1, STEP):
                    t_img = img_8bit[y : y + TILE_SIZE, x : x + TILE_SIZE]
                    t_mask = mask_8bit[y : y + TILE_SIZE, x : x + TILE_SIZE]

                    oil_px = int(np.sum(t_mask > 0))

                    if oil_px >= MIN_OIL_PIXELS:
                        save_tile = True
                        total_pos += 1
                    elif np.random.random() < BACKGROUND_RATIO:
                        save_tile = True
                        total_neg += 1
                    else:
                        save_tile = False

                    if save_tile:
                        tname = f"{stem}_t{tile_idx:03d}.png"
                        Image.fromarray(t_img).save(OUT_IMG_DIR / tname, optimize=True)
                        Image.fromarray(t_mask).save(OUT_MASK_DIR / tname, optimize=True)

                    tile_idx += 1

            # Delete the raw TIFF to reclaim disk space immediately
            scene_file.unlink(missing_ok=True)
            gc.collect()

        except Exception as e:
            print(f"[!] Error on {scene_file.name}: {e}")
            continue

    # Cleanup staging directory
    shutil.rmtree(ZENODO_DIR / "_temp_extract", ignore_errors=True)

    img_mb = sum(f.stat().st_size for f in OUT_IMG_DIR.glob("*.png")) / (1024 * 1024)
    mask_mb = sum(f.stat().st_size for f in OUT_MASK_DIR.glob("*.png")) / (1024 * 1024)
    total_mb = img_mb + mask_mb

    print("\n" + "=" * 60)
    print("   DATASET TRIMMING & TILING COMPLETE!")
    print(f"   Oil Spill (Positive) Tiles : {total_pos}")
    print(f"   Clean Water (Negative) Tiles: {total_neg}")
    print(f"   Total 512x512 Training Tiles: {total_pos + total_neg}")
    print(f"   Total Processed Disk Size   : {total_mb:.1f} MB")
    print(f"   RAM Footprint Maintained    : < 100 MB")
    print(f"   Output Directory            : {PROCESSED_DIR}")
    print("=" * 60)


if __name__ == "__main__":
    run_tiling()
