"""PyTorch Dataset & DataLoader for Trimmed SAR Oil Spill Tiles."""

import hashlib
import json
import random
from pathlib import Path
from typing import Optional, Callable
import numpy as np
from PIL import Image
import torch
from torch.utils.data import Dataset, DataLoader

from config import PROCESSED_DIR, BATCH_SIZE, NUM_WORKERS, VAL_SPLIT, SEED, MODELS_DIR
from part3_guard import assert_not_part3

# Written by make_manifests.py. Train and calibration must use this file, not a fresh shuffle.
MANIFEST_HASH = "40b2b45dd2e0"


def fit_pair(img: np.ndarray, mask: np.ndarray, height: int, width: int) -> tuple[np.ndarray, np.ndarray]:
    """Center-crop or reflect-pad an image and its mask back to (height, width).

    The mask uses the same reflect as the image. Constant-zero pad on the mask
    taught reflected slick texture as sea.
    """
    if img.shape[:2] != mask.shape[:2]:
        raise ValueError(f"image {img.shape[:2]} and mask {mask.shape[:2]} differ")
    if img.ndim != 2 or mask.ndim != 2:
        raise ValueError("fit_pair expects 2-D image and mask")
    if img.shape[0] > height:
        y0 = (img.shape[0] - height) // 2
        img = img[y0 : y0 + height]
        mask = mask[y0 : y0 + height]
    if img.shape[1] > width:
        x0 = (img.shape[1] - width) // 2
        img = img[:, x0 : x0 + width]
        mask = mask[:, x0 : x0 + width]

    def _pad_axis(arr: np.ndarray, pad_h: int, pad_w: int) -> np.ndarray:
        if pad_h < 0 or pad_w < 0:
            raise ValueError("negative pad")
        out = arr
        if pad_h:
            mode = "reflect" if pad_h < out.shape[0] else "edge"
            out = np.pad(out, ((0, pad_h), (0, 0)), mode=mode)
        if pad_w:
            mode = "reflect" if pad_w < out.shape[1] else "edge"
            out = np.pad(out, ((0, 0), (0, pad_w)), mode=mode)
        return out

    pad_h = height - img.shape[0]
    pad_w = width - img.shape[1]
    if pad_h or pad_w:
        img = _pad_axis(img, pad_h, pad_w)
        mask = _pad_axis(mask, pad_h, pad_w)
    if img.shape[:2] != (height, width) or mask.shape[:2] != (height, width):
        raise RuntimeError(f"fit_pair produced {img.shape} / {mask.shape}, want {(height, width)}")
    return img, mask


def scene_id(filename: str) -> str:
    """00004_t005.png → 00004; look_00004_t005.png → look_00004."""
    stem = filename[:-4] if filename.endswith(".png") else filename
    if "_t" in stem:
        return stem.rsplit("_t", 1)[0]
    return stem


def _family(sid: str) -> str:
    if sid.startswith("look_"):
        return "look"
    if sid.startswith("noil_"):
        return "noil"
    return "oil"


class OilSpillDataset(Dataset):
    def __init__(self, file_names: list[str], augment: bool = False):
        self.file_names = file_names
        self.img_dir = PROCESSED_DIR / "images"
        self.mask_dir = PROCESSED_DIR / "masks"
        self.augment = augment

    def __len__(self) -> int:
        return len(self.file_names)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        fname = self.file_names[idx]
        img_path = self.img_dir / fname
        mask_path = self.mask_dir / fname

        img = Image.open(img_path).convert("L")
        mask = Image.open(mask_path).convert("L")

        img_arr = np.array(img, dtype=np.float32) / 255.0  # Normalize to [0, 1]
        mask_arr = np.array(mask, dtype=np.float32)
        mask_arr = np.where(mask_arr > 127, 1.0, 0.0)  # Binary 0 or 1

        if self.augment:
            # Random horizontal flip
            if random.random() < 0.5:
                img_arr = np.fliplr(img_arr)
                mask_arr = np.fliplr(mask_arr)
            # Random vertical flip
            if random.random() < 0.5:
                img_arr = np.flipud(img_arr)
                mask_arr = np.flipud(mask_arr)
            # Random 90-degree rotations
            k = random.randint(0, 3)
            if k > 0:
                img_arr = np.rot90(img_arr, k)
                mask_arr = np.rot90(mask_arr, k)
            # Subtle contrast/brightness variation
            if random.random() < 0.4:
                alpha = random.uniform(0.85, 1.15)
                beta = random.uniform(-0.05, 0.05)
                img_arr = np.clip(img_arr * alpha + beta, 0.0, 1.0)
            # Paired mild scale (thin-tail recall) — same affine on img+mask
            if random.random() < 0.3:
                scale = random.uniform(0.9, 1.1)
                h, w = img_arr.shape[:2]
                nh, nw = max(1, int(h * scale)), max(1, int(w * scale))
                img_pil = Image.fromarray((img_arr * 255).astype(np.uint8))
                msk_pil = Image.fromarray((mask_arr * 255).astype(np.uint8))
                img_pil = img_pil.resize((nw, nh), Image.BILINEAR)
                msk_pil = msk_pil.resize((nw, nh), Image.NEAREST)
                img_rs = np.array(img_pil, dtype=np.float32) / 255.0
                msk_rs = (np.array(msk_pil) > 127).astype(np.float32)
                img_arr, mask_arr = fit_pair(img_rs, msk_rs, h, w)
            # Paired additive Gaussian noise (NOT multiplicative speckle)
            if random.random() < 0.3:
                noise = np.random.normal(0.0, 0.01, size=img_arr.shape).astype(np.float32)
                img_arr = np.clip(img_arr + noise, 0.0, 1.0)

        # Convert to contiguous channels-first PyTorch tensor: (1, H, W)
        img_t = torch.from_numpy(np.ascontiguousarray(img_arr)).unsqueeze(0).float()
        mask_t = torch.from_numpy(np.ascontiguousarray(mask_arr)).unsqueeze(0).float()

        return img_t, mask_t


def scene_role_split(val_split: float = VAL_SPLIT) -> dict[str, dict[str, list[str]]]:
    """Scene-stratified train/val IDs from processed tiles. Never includes Part III."""
    img_dir = PROCESSED_DIR / "images"
    all_files = sorted(f.name for f in img_dir.glob("*.png"))
    if not all_files:
        raise FileNotFoundError(f"No processed tiles found in {img_dir}. Run shrink_and_tile.py first!")

    by_scene: dict[str, list[str]] = {}
    for name in all_files:
        by_scene.setdefault(scene_id(name), []).append(name)

    families: dict[str, list[str]] = {"oil": [], "look": [], "noil": []}
    for sid in by_scene:
        families[_family(sid)].append(sid)

    rng = random.Random(SEED)
    roles: dict[str, dict[str, list[str]]] = {
        "oil": {"train": [], "val": []},
        "look": {"train": [], "val": []},
        "noil": {"train": [], "val": []},
    }
    for fam, scenes in families.items():
        scenes = scenes[:]
        rng.shuffle(scenes)
        n_val = int(round(len(scenes) * val_split)) if scenes else 0
        if scenes and n_val == 0 and val_split > 0:
            n_val = 1 if len(scenes) > 1 else 0
        roles[fam]["val"] = scenes[:n_val]
        roles[fam]["train"] = scenes[n_val:]
    return roles


def get_dataloaders(val_split: float = VAL_SPLIT, batch_size: int = BATCH_SIZE):
    """Scene-stratified split (oil / lookalike / no-oil separately). No tile leak."""
    img_dir = PROCESSED_DIR / "images"
    all_files = sorted([f.name for f in img_dir.glob("*.png")])

    if not all_files:
        raise FileNotFoundError(f"No processed tiles found in {img_dir}. Run shrink_and_tile.py first!")

    by_scene: dict[str, list[str]] = {}
    for name in all_files:
        by_scene.setdefault(scene_id(name), []).append(name)

    roles = scene_role_split(val_split)
    train_files: list[str] = []
    val_files: list[str] = []
    counts = {}
    for fam, split in roles.items():
        counts[fam] = (len(split["train"]), len(split["val"]))
        for sid in split["train"]:
            train_files.extend(by_scene[sid])
        for sid in split["val"]:
            val_files.extend(by_scene[sid])

    print(
        f"[*] Scene split (train/val scenes): oil {counts['oil']}, "
        f"look {counts['look']}, noil {counts['noil']}"
    )
    print(f"[*] Tiles: {len(train_files)} train, {len(val_files)} val (no shared scenes)")

    pin = torch.cuda.is_available() and NUM_WORKERS == 0
    train_loader = DataLoader(
        OilSpillDataset(train_files, augment=True),
        batch_size=batch_size,
        shuffle=True,
        num_workers=NUM_WORKERS,
        pin_memory=pin,
    )
    val_loader = DataLoader(
        OilSpillDataset(val_files, augment=False),
        batch_size=batch_size,
        shuffle=False,
        num_workers=NUM_WORKERS,
        pin_memory=pin,
    )
    return train_loader, val_loader, val_files


def load_split_manifest(path: Path | None = None) -> dict[str, list[str]]:
    """Scene-disjoint train / model_val / calibration lists. Never includes Part III."""
    manifest_path = path or (MODELS_DIR / "split_manifest.json")
    assert_not_part3(manifest_path, role="split manifest")
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    roles = {key: list(data[key]) for key in ("train", "model_val", "calibration")}
    digest = hashlib.sha256(json.dumps(roles, sort_keys=True).encode()).hexdigest()[:12]
    if data.get("hash") != MANIFEST_HASH or digest != MANIFEST_HASH:
        raise RuntimeError(
            f"split manifest hash stored={data.get('hash')} computed={digest} expected={MANIFEST_HASH}"
        )
    groups = {key: set(values) for key, values in roles.items()}
    if groups["train"] & groups["model_val"] or groups["train"] & groups["calibration"] or groups["model_val"] & groups["calibration"]:
        raise RuntimeError("split manifest has overlapping scenes")
    return roles


def _tiles_by_scene() -> dict[str, list[str]]:
    img_dir = PROCESSED_DIR / "images"
    assert_not_part3(img_dir, role="training tiles")
    names = sorted(p.name for p in img_dir.glob("*.png"))
    if not names:
        raise FileNotFoundError(f"No processed tiles found in {img_dir}.")
    by_scene: dict[str, list[str]] = {}
    for name in names:
        by_scene.setdefault(scene_id(name), []).append(name)
    return by_scene


def get_manifest_dataloaders(batch_size: int = BATCH_SIZE):
    """Train on manifest train scenes. Score epochs on model_val. Calibration stays out."""
    roles = load_split_manifest()
    by_scene = _tiles_by_scene()
    listed = set(roles["train"]) | set(roles["model_val"]) | set(roles["calibration"])
    if set(by_scene) != listed:
        missing = sorted(listed - set(by_scene))[:5]
        extra = sorted(set(by_scene) - listed)[:5]
        raise RuntimeError(f"manifest/tiles disagree missing={missing} extra={extra}")

    def _files(scene_ids: list[str]) -> list[str]:
        out: list[str] = []
        for sid in scene_ids:
            out.extend(by_scene[sid])
        return out

    train_files = _files(roles["train"])
    val_files = _files(roles["model_val"])
    overlap = set(train_files) & set(val_files)
    if overlap:
        raise RuntimeError(f"train and model_val share tiles, e.g. {next(iter(overlap))}")
    counts = {
        fam: (
            sum(1 for sid in roles["train"] if _family(sid) == fam),
            sum(1 for sid in roles["model_val"] if _family(sid) == fam),
        )
        for fam in ("oil", "look", "noil")
    }
    print(
        f"[*] Manifest {MANIFEST_HASH} scenes train/model_val: "
        f"oil {counts['oil']}, look {counts['look']}, noil {counts['noil']}"
    )
    print(
        f"[*] Tiles: {len(train_files)} train, {len(val_files)} model_val, "
        f"calibration scenes held out: {len(roles['calibration'])}"
    )
    pin = torch.cuda.is_available() and NUM_WORKERS == 0
    train_loader = DataLoader(
        OilSpillDataset(train_files, augment=True),
        batch_size=batch_size,
        shuffle=True,
        num_workers=NUM_WORKERS,
        pin_memory=pin,
    )
    val_loader = DataLoader(
        OilSpillDataset(val_files, augment=False),
        batch_size=batch_size,
        shuffle=False,
        num_workers=NUM_WORKERS,
        pin_memory=pin,
    )
    return train_loader, val_loader, val_files
