"""PyTorch Dataset & DataLoader for Trimmed SAR Oil Spill Tiles."""

import random
from pathlib import Path
from typing import Optional, Callable
import numpy as np
from PIL import Image
import torch
from torch.utils.data import Dataset, DataLoader

from config import PROCESSED_DIR, BATCH_SIZE, NUM_WORKERS, VAL_SPLIT, SEED


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

        # Convert to contiguous channels-first PyTorch tensor: (1, H, W)
        img_t = torch.from_numpy(np.ascontiguousarray(img_arr)).unsqueeze(0).float()
        mask_t = torch.from_numpy(np.ascontiguousarray(mask_arr)).unsqueeze(0).float()

        return img_t, mask_t


def get_dataloaders(val_split: float = VAL_SPLIT, batch_size: int = BATCH_SIZE):
    """Scan processed directory and split into train/val DataLoaders."""
    img_dir = PROCESSED_DIR / "images"
    all_files = sorted([f.name for f in img_dir.glob("*.png")])

    if not all_files:
        raise FileNotFoundError(f"No processed tiles found in {img_dir}. Run shrink_and_tile.py first!")

    # Deterministic split
    random.seed(SEED)
    random.shuffle(all_files)

    split_idx = int(len(all_files) * (1 - val_split))
    train_files = all_files[:split_idx]
    val_files = all_files[split_idx:]

    print(f"[*] Dataset split: {len(train_files)} training tiles, {len(val_files)} validation tiles.")

    train_dataset = OilSpillDataset(train_files, augment=True)
    val_dataset = OilSpillDataset(val_files, augment=False)

    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=NUM_WORKERS,
        pin_memory=True,
    )

    val_loader = DataLoader(
        val_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=NUM_WORKERS,
        pin_memory=True,
    )

    return train_loader, val_loader
