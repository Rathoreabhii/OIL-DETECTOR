"""Inference & Polygon Extraction for Trained Oil Spill U-Net Model."""

import sys
from pathlib import Path
from typing import Any
import numpy as np
from PIL import Image
import torch

# Ensure backend/ml is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import MODELS_DIR, TILE_SIZE


_CACHED_MODEL = None
_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
sys.stderr.reconfigure(encoding='utf-8', line_buffering=True)


def get_trained_model():
    """Load and cache the trained U-Net checkpoint if available."""
    global _CACHED_MODEL
    if _CACHED_MODEL is not None:
        return _CACHED_MODEL

    model_path = MODELS_DIR / "oil_unet.pt"
    if not model_path.exists():
        return None

    try:
        from model import build_model
        model = build_model(device=_DEVICE, pretrained=False)
        checkpoint = torch.load(model_path, map_location=_DEVICE, weights_only=False)
        state_dict = checkpoint.get("model_state_dict", checkpoint)
        model.load_state_dict(state_dict)
        model.eval()
        _CACHED_MODEL = model
        print(f"[+] Successfully loaded trained U-Net from {model_path.name}")
        return _CACHED_MODEL
    except Exception as e:
        print(f"[!] Error loading trained model: {e}")
        return None


def _as_prob_map(img_array: np.ndarray, model) -> np.ndarray:
    """Return HxW float probabilities in [0, 1] for a 2D grayscale array."""
    if img_array.ndim != 2:
        raise ValueError("predict_mask expects a 2D grayscale array")
    h, w = img_array.shape
    arr = img_array.astype(np.float32)
    if arr.max() > 1.0:
        arr /= 255.0

    def _infer_tile(patch: np.ndarray) -> np.ndarray:
        t = torch.from_numpy(np.ascontiguousarray(patch)).unsqueeze(0).unsqueeze(0).to(_DEVICE)
        with torch.no_grad():
            logits = model(t)
            return torch.sigmoid(logits.float()).squeeze().cpu().numpy()

    if h == TILE_SIZE and w == TILE_SIZE:
        return _infer_tile(arr)

    if h < TILE_SIZE or w < TILE_SIZE:
        pad_h = max(0, TILE_SIZE - h)
        pad_w = max(0, TILE_SIZE - w)
        padded = np.pad(arr, ((0, pad_h), (0, pad_w)), mode="reflect")
        return _infer_tile(padded[:TILE_SIZE, :TILE_SIZE])[:h, :w]

    prob_map = np.zeros((h, w), dtype=np.float32)
    count_map = np.zeros((h, w), dtype=np.float32)
    step = 384

    def _axis_starts(length: int) -> list[int]:
        starts = list(range(0, max(1, length - TILE_SIZE + 1), step))
        last = length - TILE_SIZE
        if last > 0 and last not in starts:
            starts.append(last)
        return starts

    for y in _axis_starts(h):
        for x in _axis_starts(w):
            patch = arr[y : y + TILE_SIZE, x : x + TILE_SIZE]
            if patch.shape != (TILE_SIZE, TILE_SIZE):
                continue
            patch_probs = _infer_tile(patch)
            prob_map[y : y + TILE_SIZE, x : x + TILE_SIZE] += patch_probs
            count_map[y : y + TILE_SIZE, x : x + TILE_SIZE] += 1.0

    count_map[count_map == 0] = 1.0
    return prob_map / count_map


def predict_mask(
    img_array: np.ndarray, model, threshold: float = 0.5, return_prob: bool = False
):
    """Run model inference on 2D grayscale image array using tiling or direct inference."""
    probs = _as_prob_map(img_array, model)
    mask = (probs > threshold).astype(np.uint8)
    if return_prob:
        return mask, probs
    return mask


def mask_to_latlon_polygon(binary_mask: np.ndarray, bounds: list, max_vertices: int = 16) -> list[list[float]]:
    """Convert largest connected component in binary mask to a simplified [lat, lon] polygon."""
    from scipy.ndimage import label
    south, west = bounds[0]
    north, east = bounds[1]
    h, w = binary_mask.shape

    labeled, num_features = label(binary_mask)
    if num_features == 0:
        return []

    # Find largest component
    counts = np.bincount(labeled.flat)
    counts[0] = 0  # ignore background
    largest_id = counts.argmax()
    if counts[largest_id] < 20:
        return []

    y_indices, x_indices = np.where(labeled == largest_id)
    cy = float(np.mean(y_indices))
    cx = float(np.mean(x_indices))

    # Approximate convex perimeter vertices
    angles = np.linspace(0, 2 * np.pi, max_vertices, endpoint=False)
    pts = []
    for theta in angles:
        # Ray cast from centroid outwards
        ray_y = cy + np.sin(theta) * (y_indices - cy)
        ray_x = cx + np.cos(theta) * (x_indices - cx)
        # Select furthest point near this angle
        dists = np.sqrt((y_indices - cy)**2 + (x_indices - cx)**2)
        angle_diffs = np.abs(np.arctan2(y_indices - cy, x_indices - cx) - theta)
        angle_diffs = np.minimum(angle_diffs, 2 * np.pi - angle_diffs)
        nearby = np.where(angle_diffs < (np.pi / max_vertices))[0]
        if len(nearby) > 0:
            furthest = nearby[np.argmax(dists[nearby])]
            py, px = y_indices[furthest], x_indices[furthest]
        else:
            py, px = cy, cx

        # Map pixel (py, px) to [lat, lon] (row 0 is north)
        lat = north - (py / h) * (north - south)
        lon = west + (px / w) * (east - west)
        pts.append([round(float(lat), 5), round(float(lon), 5)])

    # Close the ring
    if pts and pts[0] != pts[-1]:
        pts.append(pts[0])

    return pts
