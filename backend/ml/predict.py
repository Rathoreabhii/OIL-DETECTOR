"""Inference & polygon extraction for the trained oil-spill U-Net.

Operating-point knobs (threshold, hysteresis, blob size) must be chosen on a
Part 1/2 calibration split — never on Zenodo Part III (`data/zenodo/Images`).
"""

import sys
from pathlib import Path
from typing import Any
import numpy as np
from PIL import Image
import torch
import cv2

# Ensure backend/ml is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import MODELS_DIR, TILE_SIZE, OVERLAP

# Calibrated operating point from Part 1/2 val scenes (calibration_part12.json).
# Part III is strictly preserved as frozen test set.
DEFAULT_THRESHOLD = 0.15
MIN_BLOB_PX = 200
MORPH_KERNEL_SIZE = 7
ENABLE_TTA = True
EVAL_OVERLAP = 128
GAUSSIAN_STITCH = True
GAUSSIAN_SIGMA_SCALE = 0.25
THRESHOLD_MODE = "single"  # "hysteresis" only after Part 1/2 calibration
HYST_LOW = 0.20
HYST_HIGH = 0.45
DARK_GROW = False
DARK_GROW_RADIUS = 16
DARK_GROW_GAP = 25.0
DARK_CORE_THRESHOLD = 0.45

_GAUSS_CACHE: dict[tuple[int, float], np.ndarray] = {}
INFER_BATCH = 8


_CACHED_MODEL = None
_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
sys.stderr.reconfigure(encoding='utf-8', line_buffering=True)


def load_weights(path: Path | None = None):
    """Load one checkpoint. Does not use the API cache."""
    model_path = Path(path) if path else MODELS_DIR / "oil_unet.pt"
    if not model_path.is_file():
        return None
    try:
        from model import build_model
        model = build_model(device=_DEVICE, pretrained=False)
        checkpoint = torch.load(model_path, map_location=_DEVICE, weights_only=False)
        state_dict = checkpoint.get("model_state_dict", checkpoint)
        model.load_state_dict(state_dict)
        model.eval()
        print(f"[+] Loaded U-Net weights from {model_path.name}")
        return model
    except Exception as e:
        print(f"[!] Error loading trained model: {e}")
        return None


def get_trained_model():
    """Load and cache the live U-Net checkpoint (oil_unet.pt) if available."""
    global _CACHED_MODEL
    if _CACHED_MODEL is not None:
        return _CACHED_MODEL
    _CACHED_MODEL = load_weights(MODELS_DIR / "oil_unet.pt")
    return _CACHED_MODEL


def gaussian_tile_weight(tile_size: int = TILE_SIZE, sigma_scale: float = GAUSSIAN_SIGMA_SCALE) -> np.ndarray:
    """Center-heavy 2-D Gaussian used when stitching overlapping tiles."""
    if tile_size < 1:
        raise ValueError("tile_size must be positive")
    if sigma_scale <= 0.0:
        raise ValueError("sigma_scale must be > 0")
    key = (tile_size, float(sigma_scale))
    cached = _GAUSS_CACHE.get(key)
    if cached is not None:
        return cached
    sigma = tile_size * sigma_scale
    center = (tile_size - 1) / 2.0
    axis = np.arange(tile_size, dtype=np.float32)
    yy, xx = np.meshgrid(axis, axis, indexing="ij")
    weight = np.exp(-((xx - center) ** 2 + (yy - center) ** 2) / (2.0 * sigma * sigma))
    weight = np.ascontiguousarray(weight, dtype=np.float32)
    _GAUSS_CACHE[key] = weight
    return weight


def axis_tile_starts(length: int, tile_size: int, step: int) -> list[int]:
    """Inclusive starts so the last window always covers the far edge."""
    if tile_size < 1 or step < 1:
        raise ValueError("tile_size and step must be positive")
    if length <= tile_size:
        return [0]
    starts = list(range(0, length - tile_size + 1, step))
    last = length - tile_size
    if last not in starts:
        starts.append(last)
    return starts


def pad_for_tiles(arr: np.ndarray, tile_size: int = TILE_SIZE) -> tuple[np.ndarray, int, int]:
    """Pad each axis independently so both dims are >= tile_size. Crop callers use the returned original size."""
    if arr.ndim != 2:
        raise ValueError(f"expected 2-D array, got shape {arr.shape}")
    h, w = arr.shape
    pad_h = max(0, tile_size - h)
    pad_w = max(0, tile_size - w)
    if pad_h or pad_w:
        arr = np.pad(arr, ((0, pad_h), (0, pad_w)), mode="reflect")
    return arr, h, w


def apply_hysteresis(probs: np.ndarray, low: float, high: float) -> np.ndarray:
    """Keep weak pixels only if they belong to a component that contains a high-confidence core.

    Isolated weak-only components are dropped. There is no weak-only fallback.
    """
    if probs.ndim != 2:
        raise ValueError("hysteresis expects a 2-D probability map")
    if not (0.0 < low < high < 1.0):
        raise ValueError("hysteresis requires 0 < low < high < 1")
    weak = (probs >= low).astype(np.uint8)
    if not weak.any():
        return weak
    strong = probs >= high
    n_labels, labels = cv2.connectedComponents(weak, connectivity=8)
    keep = np.zeros_like(weak)
    for label_id in range(1, n_labels):
        region = labels == label_id
        if strong[region].any():
            keep[region] = 1
    return keep


def _as_prob_map(
    img_array: np.ndarray,
    model,
    overlap: int | None = None,
    *,
    use_gaussian: bool = GAUSSIAN_STITCH,
    gaussian_sigma_scale: float = GAUSSIAN_SIGMA_SCALE,
) -> np.ndarray:
    """Return HxW float probabilities in [0, 1] for a 2D grayscale array.

    Pads short axes instead of cropping them. Overlapping tiles are Gaussian-
    weighted by default so tile centers outvote padded edges.
    """
    if img_array.ndim != 2:
        raise ValueError("predict_mask expects a 2D grayscale array")
    arr = img_array.astype(np.float32, copy=False)
    if arr.max() > 1.0:
        arr = arr / 255.0

    overlap_px = OVERLAP if overlap is None else int(overlap)
    if overlap_px < 0 or overlap_px >= TILE_SIZE:
        raise ValueError("overlap must satisfy 0 <= overlap < TILE_SIZE")
    step = TILE_SIZE - overlap_px

    def _infer_batch(patches: list[np.ndarray]) -> np.ndarray:
        batch = np.stack([np.ascontiguousarray(patch) for patch in patches], axis=0)
        tensor = torch.from_numpy(batch).unsqueeze(1).to(_DEVICE)
        with torch.inference_mode():
            logits = model(tensor)
            out = torch.sigmoid(logits.float()).squeeze(1).detach().cpu().numpy()
        if out.shape[1:] != (TILE_SIZE, TILE_SIZE):
            raise RuntimeError(f"tile logits shape {out.shape} != {(len(patches), TILE_SIZE, TILE_SIZE)}")
        return out.astype(np.float32, copy=False)

    orig_h, orig_w = arr.shape
    if orig_h == TILE_SIZE and orig_w == TILE_SIZE:
        return _infer_batch([arr])[0]

    padded, h0, w0 = pad_for_tiles(arr, TILE_SIZE)
    ph, pw = padded.shape
    prob_map = np.zeros((ph, pw), dtype=np.float32)
    weight_map = np.zeros((ph, pw), dtype=np.float32)
    tile_w = gaussian_tile_weight(TILE_SIZE, gaussian_sigma_scale) if use_gaussian else np.ones(
        (TILE_SIZE, TILE_SIZE), dtype=np.float32
    )

    coords = [(y, x) for y in axis_tile_starts(ph, TILE_SIZE, step) for x in axis_tile_starts(pw, TILE_SIZE, step)]
    for start in range(0, len(coords), INFER_BATCH):
        chunk = coords[start : start + INFER_BATCH]
        patches = []
        for y, x in chunk:
            patch = padded[y : y + TILE_SIZE, x : x + TILE_SIZE]
            if patch.shape != (TILE_SIZE, TILE_SIZE):
                raise RuntimeError(f"unpadded tile at {(y, x)} shape {patch.shape}")
            patches.append(patch)
        predicted = _infer_batch(patches)
        for (y, x), patch_probs in zip(chunk, predicted):
            prob_map[y : y + TILE_SIZE, x : x + TILE_SIZE] += patch_probs * tile_w
            weight_map[y : y + TILE_SIZE, x : x + TILE_SIZE] += tile_w

    if (weight_map <= 0).any():
        raise RuntimeError("tile stitch left uncovered pixels")
    stitched = prob_map / weight_map
    return stitched[:h0, :w0]


def _tta_prob_map(
    img_array: np.ndarray,
    model,
    overlap: int | None = None,
    *,
    use_gaussian: bool = GAUSSIAN_STITCH,
    gaussian_sigma_scale: float = GAUSSIAN_SIGMA_SCALE,
) -> np.ndarray:
    """Average original + H/V/HV flips. Shape of each pass matches the input."""
    kw = {"overlap": overlap, "use_gaussian": use_gaussian, "gaussian_sigma_scale": gaussian_sigma_scale}
    probs = _as_prob_map(img_array, model, **kw)
    probs_h = np.fliplr(_as_prob_map(np.fliplr(img_array), model, **kw))
    probs_v = np.flipud(_as_prob_map(np.flipud(img_array), model, **kw))
    probs_hv = np.fliplr(np.flipud(_as_prob_map(np.flipud(np.fliplr(img_array)), model, **kw)))
    return (probs + probs_h + probs_v + probs_hv) / 4.0


def _morphological_close(mask: np.ndarray, kernel_size: int = MORPH_KERNEL_SIZE) -> np.ndarray:
    """Fill internal holes and smooth jagged slick edges with morphological closing."""
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)


def grow_dark_rim(
    img: np.ndarray,
    probs: np.ndarray,
    core: np.ndarray,
    radius: int = 32,
    gap: float = 40.0,
) -> np.ndarray:
    """Add pixels that are darker than local sea and connected to a confident core.

    Growth stops at `radius` pixels. Bright water next to a slick is not filled in.
    `img` is the same 8-bit stretch the U-Net saw. Lower gray means darker radar return.
    """
    if radius < 1:
        raise ValueError("radius must be positive")
    gray = img
    if gray.ndim == 3:
        gray = gray[:, :, 0]
    if gray.dtype != np.uint8:
        peak = float(np.max(gray)) if gray.size else 0.0
        scale = 255.0 if peak <= 1.0 else 1.0
        gray = np.clip(gray.astype(np.float32) * scale, 0, 255).astype(np.uint8)
    core_u8 = (core > 0).astype(np.uint8)
    if not core_u8.any():
        return core_u8
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
    near = cv2.dilate(core_u8, kernel)
    far = near == 0
    calm = far & (probs < 0.10)
    sample = gray[calm] if int(calm.sum()) >= 500 else gray[far]
    if sample.size < 100:
        sample = gray.reshape(-1)
    water = float(np.median(sample))
    dark = gray <= (water - float(gap))
    candidate = ((dark & (near > 0)) | (core_u8 > 0)).astype(np.uint8)
    count, labels = cv2.connectedComponents(candidate, connectivity=8)
    keep = np.zeros_like(candidate)
    core_bool = core_u8 > 0
    for label_id in range(1, count):
        region = labels == label_id
        if core_bool[region].any():
            keep[region] = 1
    return keep


def _remove_small_blobs(mask: np.ndarray, min_px: int = MIN_BLOB_PX) -> np.ndarray:
    """Discard isolated connected components smaller than min_px pixels.

    Real oil spills are large contiguous slicks. Tiny isolated blobs are
    radar speckle noise, wave crests, or thermal artefacts.
    """
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    out = np.zeros_like(mask)
    for label_id in range(1, n_labels):  # skip background (0)
        area = stats[label_id, cv2.CC_STAT_AREA]
        if area >= min_px:
            out[labels == label_id] = 1
    return out


def predict_mask(
    img_array: np.ndarray,
    model,
    threshold: float = DEFAULT_THRESHOLD,
    return_prob: bool = False,
    use_tta: bool = ENABLE_TTA,
    use_postprocess: bool = True,
    overlap: int | None = None,
    min_blob_px: int = MIN_BLOB_PX,
    threshold_mode: str = THRESHOLD_MODE,
    hyst_low: float = HYST_LOW,
    hyst_high: float = HYST_HIGH,
    use_gaussian: bool = GAUSSIAN_STITCH,
    use_dark_grow: bool = DARK_GROW,
    dark_grow_radius: int = DARK_GROW_RADIUS,
    dark_grow_gap: float = DARK_GROW_GAP,
    dark_core_threshold: float = DARK_CORE_THRESHOLD,
):
    """TTA → threshold or dark-rim growth → optional close + blob filter.

    Dark-rim growth keeps a confident core, then adds nearby pixels that are
    darker than the surrounding sea. Hysteresis stays off.
    """
    ov = overlap if overlap is not None else (EVAL_OVERLAP if use_tta else OVERLAP)
    stitch_kw = {"overlap": ov, "use_gaussian": use_gaussian}
    if use_tta:
        probs = _tta_prob_map(img_array, model, **stitch_kw)
    else:
        probs = _as_prob_map(img_array, model, **stitch_kw)

    if use_dark_grow:
        core = (probs >= dark_core_threshold).astype(np.uint8)
        if use_postprocess and core.any():
            core = _morphological_close(core)
            core = _remove_small_blobs(core, min_px=min_blob_px)
        mask = grow_dark_rim(img_array, probs, core, dark_grow_radius, dark_grow_gap)
    else:
        mode = (threshold_mode or "single").lower()
        if mode == "hysteresis":
            mask = apply_hysteresis(probs, hyst_low, hyst_high)
        elif mode == "single":
            mask = (probs > threshold).astype(np.uint8)
        else:
            raise ValueError("threshold_mode must be 'single' or 'hysteresis'")
        if use_postprocess and mask.any():
            mask = _morphological_close(mask)
            mask = _remove_small_blobs(mask, min_px=min_blob_px)

    if return_prob:
        return mask, probs
    return mask


def predict_mask_raw(
    img_array: np.ndarray, model, threshold: float = 0.5
):
    """Legacy raw prediction without TTA or post-processing (for backward compat)."""
    probs = _as_prob_map(img_array, model)
    return (probs > threshold).astype(np.uint8)


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
