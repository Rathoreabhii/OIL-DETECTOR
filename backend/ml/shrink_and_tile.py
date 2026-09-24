"""Dataset Shrinking and Tiling Script for Sentinel-1 SAR Oil Spill Data.

This script takes the 2048x2048 raw TIFFs/PNGs from Zenodo Part 1 and:
1. Extracts archives if needed.
2. Slices 2048x2048 scenes into 512x512 patches.
3. Filters out redundant empty-sea tiles (keeping slicks + 15% clean water for contrast).
4. Limits total dataset footprint to under ~3-5 GB.
5. Saves clean 8-bit PNG tiles for fast, memory-efficient PyTorch loading.
"""

import os
import sys
import random
import shutil
from pathlib import Path
import numpy as np
from PIL import Image
from tqdm import tqdm

from config import (
    ZENODO_RAW_DIR,
    PROCESSED_DIR,
    TILE_SIZE,
    OVERLAP,
    MIN_OIL_PIXELS,
    BACKGROUND_SAMPLE_RATIO,
    MAX_SCENES_TO_PROCESS,
    SEED,
)

# Set seed for reproducible random selection
random.seed(SEED)
np.random.seed(SEED)


def extract_7z_archives():
    """Extract .7z archives if present in ZENODO_RAW_DIR."""
    archives = list(ZENODO_RAW_DIR.glob("*.7z"))
    if not archives:
        return

    try:
        import py7zr
    except ImportError:
        print("[!] py7zr not installed. Run: pip install py7zr")
        return

    for arc in archives:
        extract_target = ZENODO_RAW_DIR / arc.stem
        if extract_target.exists() and any(extract_target.iterdir()):
            print(f"[*] Already extracted: {arc.name}")
            continue

        print(f"[*] Extracting {arc.name} (this may take a few minutes)...")
        with py7zr.SevenZipFile(arc, mode='r') as z:
            z.extractall(path=extract_target)
        print(f"[✓] Extracted: {arc.name}")


def load_image(file_path: Path) -> np.ndarray:
    """Load image (TIFF, PNG, etc.) as normalized 8-bit or float array."""
    try:
        import tifffile
        arr = tifffile.imread(str(file_path))
    except Exception:
        img = Image.open(file_path)
        arr = np.array(img)

    if arr.ndim == 3:
        arr = arr[:, :, 1] if arr.shape[-1] >= 2 else arr[:, :, 0]

    # Normalize to 0-255 uint8 if needed
    if arr.dtype != np.uint8:
        p2, p98 = np.percentile(arr, (2, 98))
        if p98 > p2:
            arr = np.clip(arr, p2, p98)
            arr = ((arr - p2) / (p98 - p2) * 255).astype(np.uint8)
        else:
            arr = arr.astype(np.uint8)

    return arr


def load_mask(file_path: Path) -> np.ndarray:
    """Load mask as binary 0 or 255."""
    img = Image.open(file_path)
    arr = np.array(img)
    if arr.ndim == 3:
        arr = arr[:, :, 0]
    # Binary threshold
    return np.where(arr > 0, 255, 0).astype(np.uint8)


def _tile_starts(length: int, tile: int, step: int) -> list[int]:
    if length <= tile:
        return [0]
    starts = list(range(0, length - tile + 1, step))
    last = length - tile
    if last not in starts:
        starts.append(last)
    return starts


def tile_scene(img: np.ndarray, mask: np.ndarray, tile_size: int = 512, step: int = 448):
    """Slice 2D image and mask into overlapping 512x512 tiles (far-edge covered)."""
    h, w = img.shape
    tiles = []
    for y in _tile_starts(h, tile_size, step):
        for x in _tile_starts(w, tile_size, step):
            img_tile = img[y : y + tile_size, x : x + tile_size]
            mask_tile = mask[y : y + tile_size, x : x + tile_size]
            tiles.append((img_tile, mask_tile))
    return tiles


def process_dataset(max_scenes: int = MAX_SCENES_TO_PROCESS):
    """Main shrinkage and tiling routine."""
    print("=" * 60)
    print("SAR Oil Spill Dataset Trimmer & Tiler")
    print(f"Targeting budget: < 5-6 GB (Max scenes: {max_scenes})")
    print("=" * 60)

    # 1. Archives are already extracted, skip extraction to avoid redundant 30+ min unpack
    # extract_7z_archives()

    # 2. Find image & mask files directly from extracted subdirectories
    img_candidates = list((ZENODO_RAW_DIR / "01_Train_Val_Oil_Spill_images" / "Oil").glob("*.tif*"))
    mask_candidates = list((ZENODO_RAW_DIR / "masks" / "Mask_oil").glob("*.tif*"))

    if not img_candidates:
        img_candidates = list(ZENODO_RAW_DIR.rglob("*Oil*/*.tif*"))
        img_candidates = [p for p in img_candidates if "mask" not in p.name.lower() and "mask" not in str(p.parent).lower()]
    if not mask_candidates:
        mask_candidates = list(ZENODO_RAW_DIR.rglob("*mask*/*.tif*"))

    print(f"[*] Found {len(img_candidates)} candidate oil scenes and {len(mask_candidates)} masks.")

    if not img_candidates or not mask_candidates:
        print("[!] Missing images or masks! Check directory paths.")
        return

    # Build pairs based on stem match
    mask_map = {m.stem: m for m in mask_candidates}
    pairs = []
    for img_path in img_candidates:
        if img_path.stem in mask_map:
            pairs.append((img_path, mask_map[img_path.stem]))

    print(f"[*] Matched {len(pairs)} image-mask pairs.")

    # Shuffle and trim scene count
    random.shuffle(pairs)
    pairs = pairs[:max_scenes]
    print(f"[*] Selected {len(pairs)} scenes to process into 512x512 tiles.")

    # Prepare output folders
    out_img_dir = PROCESSED_DIR / "images"
    out_mask_dir = PROCESSED_DIR / "masks"
    out_img_dir.mkdir(parents=True, exist_ok=True)
    out_mask_dir.mkdir(parents=True, exist_ok=True)

    positive_tiles = 0
    negative_tiles = 0
    step = TILE_SIZE - OVERLAP

    for idx, (img_p, mask_p) in enumerate(tqdm(pairs, desc="Tiling scenes")):
        try:
            img = load_image(img_p)
            mask = load_mask(mask_p)

            if img.shape != mask.shape:
                continue

            tiles = tile_scene(img, mask, tile_size=TILE_SIZE, step=step)

            for t_idx, (t_img, t_mask) in enumerate(tiles):
                oil_pixels = np.sum(t_mask > 0)

                # Keep tile if it contains oil
                if oil_pixels >= MIN_OIL_PIXELS:
                    save_tile = True
                    positive_tiles += 1
                else:
                    # Randomly sample clean water / background to prevent false positives
                    if random.random() < BACKGROUND_SAMPLE_RATIO:
                        save_tile = True
                        negative_tiles += 1
                    else:
                        save_tile = False

                if save_tile:
                    scene_name = img_p.stem
                    tile_name = f"{scene_name}_tile_{t_idx:03d}.png"
                    Image.fromarray(t_img).save(out_img_dir / tile_name, optimize=True)
                    Image.fromarray(t_mask).save(out_mask_dir / tile_name, optimize=True)

        except Exception as e:
            print(f"\n[!] Error processing {img_p.name}: {e}")
            continue

    total_tiles = positive_tiles + negative_tiles
    # Calculate folder size
    size_mb = sum(f.stat().st_size for f in out_img_dir.glob("*.png")) / (1024 * 1024)
    size_mb += sum(f.stat().st_size for f in out_mask_dir.glob("*.png")) / (1024 * 1024)

    print("\n" + "=" * 60)
    print("Tiling & Shrinking Complete!")
    print(f"Total tiles created: {total_tiles} ({positive_tiles} oil, {negative_tiles} clean background)")
    print(f"Final trimmed dataset size on disk: {size_mb:.1f} MB (~{size_mb/1024:.2f} GB)")
    print(f"Saved to: {PROCESSED_DIR}")
    print("=" * 60)


if __name__ == "__main__":
    process_dataset()
