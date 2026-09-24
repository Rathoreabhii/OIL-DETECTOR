"""SAR slick detect: U-Net if oil_unet.pt loads, else classical dark-spot."""

from __future__ import annotations

import io
import json
import math
import struct
import sys
import zlib
from array import array
from pathlib import Path
from typing import Any

PNG_SIG = b"\x89PNG\r\n\x1a\n"
TIFF_MAGICS = (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+")
# Same band as training: DIMAP Sigma0_VV_db is TIFF index 1.
SAR_POL_INDEX = 1
EARTH_RADIUS_KM = 6371.0
K_STD = 1.2
MIN_POLY = 8
MAX_POLY = 20
RGB_CHROMA_THR = 15.0
MAX_PIXELS = 16_000_000
NOTE_BASELINE = (
    "Classical dark-spot on SAR-like grayscale. Not a trained model. "
    "RGB photos will be garbage."
)
NOTE_RGB = (
    "RGB not SAR. Classical dark-spot on SAR-like grayscale. "
    "Not a trained model. RGB photos will be garbage."
)


class _NeedFallback(Exception):
    """Stdlib decoder cannot handle this PNG; try PIL."""


def detect_slick(image_bytes: bytes, bounds: list) -> dict:
    """Find a slick polygon in lat/lon.

    bounds = [[south, west], [north, east]]. Row 0 is north.
    Uses U-Net when ``backend/models/oil_unet.pt`` loads and the image is
    not an RGB photo; otherwise classical dark-spot. Empty U-Net polygons
    and load errors fall back to dark-spot (see stderr).
    """
    if isinstance(image_bytes, memoryview):
        image_bytes = image_bytes.tobytes()
    elif isinstance(image_bytes, bytearray):
        image_bytes = bytes(image_bytes)
    if not isinstance(image_bytes, bytes):
        raise ValueError("image_bytes must be PNG, JPEG, or GeoTIFF bytes")
    if not image_bytes:
        raise ValueError("Cannot decode image: empty payload")

    south, west, north, east = _parse_bounds(bounds)
    try:
        gray, n_channels, chroma = _decode_image(image_bytes)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"Cannot decode image: {exc}") from exc
    preview_url = _save_upload_preview(gray)
    height = len(gray)
    width = len(gray[0]) if height else 0
    if height < 1 or width < 1:
        raise ValueError("Cannot decode image: zero-sized raster")

    rgb_photo = n_channels >= 3 and chroma >= RGB_CHROMA_THR

    # Check if trained deep-learning U-Net model is present
    model_path = Path(__file__).resolve().parent / "models" / "oil_unet.pt"
    if model_path.is_file() and not rgb_photo:
        try:
            import numpy as np
            from ml.predict import get_trained_model, predict_mask, mask_to_latlon_polygon

            unet_model = get_trained_model()
            if unet_model is not None:
                arr_2d = np.array(gray, dtype=np.uint8)
                pred_mask, probs = predict_mask(arr_2d, unet_model, return_prob=True)
                poly_ll = mask_to_latlon_polygon(pred_mask, bounds)
                if not poly_ll or len(poly_ll) < 3:
                    print(
                        "[detect] U-Net produced no usable polygon, dark-spot fallback",
                        file=sys.stderr,
                    )
                elif poly_ll and len(poly_ll) >= 3:
                    cy = sum(p[0] for p in poly_ll) / len(poly_ll)
                    cx = sum(p[1] for p in poly_ll) / len(poly_ll)
                    oil_pixels = int(np.sum(pred_mask > 0))
                    area_km2 = _pixel_area_km2(
                        oil_pixels, south, west, north, east, height, width, cy
                    )
                    oil_probs = probs[pred_mask > 0]
                    mean_p = float(oil_probs.mean()) if oil_probs.size else 0.0
                    confidence = _clamp01(0.25 + 0.70 * mean_p)
                    return {
                        "polygon": [[round(p[0], 6), round(p[1], 6)] for p in poly_ll],
                        "centroid": [round(cy, 6), round(cx, 6)],
                        "area_km2": round(area_km2, 3),
                        "confidence": round(confidence, 3),
                        "age_hours_est": 16,
                        "preview_url": preview_url,
                        "source": "unet-sentinel1",
                        "note": (
                            "U-Net on Sentinel-1-like grayscale. "
                            "Not operational NTRO. RGB photos will be garbage."
                        ),
                    }
        except Exception as exc:
            print(f"[detect] U-Net path failed, dark-spot fallback: {exc}", file=sys.stderr)

    pixels, stats = _largest_dark_blob(gray, K_STD)

    if pixels:
        n_pix = len(pixels)
        row_c = sum(r + 0.5 for r, _c in pixels) / n_pix
        col_c = sum(c + 0.5 for _r, c in pixels) / n_pix
        poly_rc = _blob_polygon(pixels, width, height, row_c, col_c)
    else:
        n_pix = 0
        row_c = height / 2.0
        col_c = width / 2.0
        poly_rc = _circle_rc(row_c, col_c, max(2.0, min(width, height) * 0.02), 12)

    polygon = [
        _rc_to_ll(r, c, south, west, north, east, height, width) for r, c in poly_rc
    ]
    if len(polygon) < MIN_POLY:
        polygon = _densify_ll(polygon, MIN_POLY)
    elif len(polygon) > MAX_POLY:
        polygon = _even_sample(polygon, MAX_POLY)

    centroid = _rc_to_ll(row_c, col_c, south, west, north, east, height, width)
    area_km2 = _pixel_area_km2(
        n_pix, south, west, north, east, height, width, centroid[0]
    )
    confidence = _confidence(stats, n_pix, width * height)
    note = NOTE_BASELINE
    if rgb_photo:
        confidence = _clamp01(confidence * 0.25)
        note = NOTE_RGB

    return {
        "polygon": [[round(p[0], 6), round(p[1], 6)] for p in polygon],
        "centroid": [round(centroid[0], 6), round(centroid[1], 6)],
        "area_km2": round(area_km2, 3),
        "confidence": round(confidence, 3),
        "age_hours_est": 16,
        "preview_url": preview_url,
        "source": "baseline-darkspot",
        "note": note,
    }


def _save_upload_preview(gray: list[array]) -> str:
    """Write 8-bit preview so the dashboard can show the uploaded SAR frame."""
    try:
        import numpy as np
        from PIL import Image
    except ImportError:
        return ""
    try:
        arr = np.array(gray, dtype=np.uint8)
        out = Path(__file__).resolve().parent.parent / "data" / "demo" / "upload_preview.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(arr, mode="L").save(out)
        return "/demo/upload_preview.png"
    except Exception:
        return ""


def _clamp01(value: float) -> float:
    if value <= 0.0:
        return 0.0
    if value >= 1.0:
        return 1.0
    return float(value)


def _parse_bounds(bounds: Any) -> tuple[float, float, float, float]:
    try:
        sw, ne = bounds[0], bounds[1]
        south, west = float(sw[0]), float(sw[1])
        north, east = float(ne[0]), float(ne[1])
    except (TypeError, ValueError, IndexError, KeyError) as exc:
        raise ValueError("bounds must be [[south, west], [north, east]]") from exc
    if not all(math.isfinite(v) for v in (south, west, north, east)):
        raise ValueError("bounds must be finite lat/lon values")
    if north < south:
        south, north = north, south
    if north == south or west == east:
        raise ValueError("bounds must span a non-zero area")
    return south, west, north, east


def _rc_to_ll(
    row: float,
    col: float,
    south: float,
    west: float,
    north: float,
    east: float,
    height: int,
    width: int,
) -> list[float]:
    lat = north - (row / height) * (north - south)
    lon = west + (col / width) * (east - west)
    return [lat, lon]


def _pixel_area_km2(
    n_pix: int,
    south: float,
    west: float,
    north: float,
    east: float,
    height: int,
    width: int,
    lat_c: float,
) -> float:
    if n_pix <= 0 or height <= 0 or width <= 0:
        return 0.0
    km_per_deg_lat = EARTH_RADIUS_KM * math.pi / 180.0
    km_per_deg_lon = km_per_deg_lat * math.cos(math.radians(lat_c))
    dlat = abs(north - south) / height
    dlon = abs(east - west) / width
    return float(n_pix) * dlat * dlon * km_per_deg_lat * km_per_deg_lon


def _confidence(stats: dict[str, float], n_pix: int, n_total: int) -> float:
    if n_pix <= 0 or n_total <= 0:
        return 0.0
    std = stats.get("std", 0.0)
    mean = stats.get("mean", 0.0)
    blob_mean = stats.get("blob_mean", mean)
    contrast = (mean - blob_mean) / (std + 1e-6)
    contrast_term = _clamp01(contrast / 2.5)
    size_term = _clamp01(math.log10(max(n_pix, 1)) / math.log10(2000.0))
    conf = 0.55 * contrast_term + 0.45 * size_term
    frac = n_pix / n_total
    if frac > 0.20:
        conf *= max(0.2, 1.0 - (frac - 0.20) / 0.50)
    return _clamp01(conf)


def _decode_image(image_bytes: bytes) -> tuple[list[array], int, float]:
    """Return (gray rows 0–255, color-channel count, mean per-pixel chroma)."""
    if image_bytes.startswith(PNG_SIG):
        try:
            return _decode_png(image_bytes)
        except _NeedFallback:
            return _decode_pil(image_bytes, hint="PNG")
        except ValueError as png_exc:
            try:
                return _decode_pil(image_bytes, hint="PNG")
            except Exception:
                raise png_exc from None
    if len(image_bytes) >= 2 and image_bytes[:2] == b"\xff\xd8":
        return _decode_pil(image_bytes, hint="JPEG")
    if len(image_bytes) >= 4 and image_bytes[:4] in TIFF_MAGICS:
        return _decode_tiff(image_bytes)
    try:
        return _decode_pil(image_bytes, hint="image")
    except Exception as exc:
        raise ValueError("Cannot decode image: expected PNG, JPEG, or GeoTIFF (.tif) bytes") from exc


def _decode_tiff(image_bytes: bytes) -> tuple[list[array], int, float]:
    """32-bit / uint SAR GeoTIFF → 8-bit gray, same stretch as training (VV index 1)."""
    try:
        import numpy as np
        import tifffile
    except ImportError as exc:
        raise ValueError(
            "Cannot decode GeoTIFF: install tifffile and numpy (backend/ml/requirements.txt)"
        ) from exc
    try:
        arr = tifffile.imread(io.BytesIO(image_bytes))
    except Exception as exc:
        raise ValueError(f"Cannot decode GeoTIFF: {exc}") from exc
    if arr is None or arr.size == 0:
        raise ValueError("Cannot decode GeoTIFF: empty raster")
    arr = np.asarray(arr)
    if arr.ndim == 3:
        ch = min(SAR_POL_INDEX, arr.shape[-1] - 1)
        arr = arr[:, :, ch]
    elif arr.ndim != 2:
        raise ValueError(f"Cannot decode GeoTIFF: unexpected shape {arr.shape}")
    h, w = int(arr.shape[0]), int(arr.shape[1])
    if h < 1 or w < 1:
        raise ValueError("Cannot decode GeoTIFF: zero-sized raster")
    if h * w > MAX_PIXELS:
        raise ValueError("Cannot decode GeoTIFF: image is too large")
    if arr.dtype == np.uint8:
        gray8 = arr
    else:
        a = arr.astype(np.float32, copy=False)
        p2, p98 = np.percentile(a, (2, 98))
        if p98 > p2:
            a = np.clip(a, p2, p98)
            gray8 = ((a - p2) / (p98 - p2) * 255.0).astype(np.uint8)
        else:
            gray8 = np.clip(a, 0, 255).astype(np.uint8)
    gray = [array("B", gray8[r].tobytes()) for r in range(h)]
    return gray, 1, 0.0


def _decode_pil(image_bytes: bytes, hint: str) -> tuple[list[array], int, float]:
    try:
        from PIL import Image
    except ImportError as exc:
        raise ValueError(
            f"Cannot decode {hint}: Pillow (PIL) is not installed; "
            "PNG is supported via the standard library"
        ) from exc
    try:
        im = Image.open(io.BytesIO(image_bytes))
        im.load()
    except Exception as exc:
        raise ValueError(
            f"Cannot decode {hint}: file is corrupt or not a valid PNG/JPEG/GeoTIFF"
        ) from exc

    mode = im.mode
    rgb_im = im.convert("RGB")
    gray_im = im.convert("L")
    width, height = gray_im.size
    if width < 1 or height < 1:
        raise ValueError(f"Cannot decode {hint}: zero-sized raster")
    if width * height > MAX_PIXELS:
        raise ValueError(f"Cannot decode {hint}: image is too large")

    gbuf = gray_im.tobytes()
    gray = [array("B", gbuf[r * width : (r + 1) * width]) for r in range(height)]

    if mode in ("1", "L", "I", "F", "LA", "I;16"):
        return gray, 1, 0.0

    rbuf = rgb_im.tobytes()
    chroma_acc = 0.0
    n = width * height
    for i in range(0, n * 3, 3):
        r, g, b = rbuf[i], rbuf[i + 1], rbuf[i + 2]
        mx = r if r > g else g
        if b > mx:
            mx = b
        mn = r if r < g else g
        if b < mn:
            mn = b
        chroma_acc += mx - mn
    return gray, 3, chroma_acc / n if n else 0.0


def _decode_png(data: bytes) -> tuple[list[array], int, float]:
    if not data.startswith(PNG_SIG):
        raise ValueError("Cannot decode PNG: missing PNG signature")
    if len(data) < 33:
        raise ValueError("Cannot decode PNG: truncated file")

    width = height = bit_depth = color_type = None
    interlace = 0
    palette: list[tuple[int, int, int]] | None = None
    idat = bytearray()
    offset = 8
    saw_iend = False
    while offset + 8 <= len(data):
        length = struct.unpack_from(">I", data, offset)[0]
        ctype = data[offset + 4 : offset + 8]
        start = offset + 8
        end = start + length
        if length > 80_000_000 or end + 4 > len(data):
            raise ValueError("Cannot decode PNG: truncated or oversized chunk")
        chunk = data[start:end]
        if ctype == b"IHDR":
            if length != 13:
                raise ValueError("Cannot decode PNG: bad IHDR")
            width, height, bit_depth, color_type, comp, filt, interlace = struct.unpack(
                ">IIBBBBB", chunk
            )
            if comp != 0 or filt != 0:
                raise ValueError("Cannot decode PNG: unsupported compression/filter")
            if width < 1 or height < 1:
                raise ValueError("Cannot decode PNG: zero-sized raster")
            if width * height > MAX_PIXELS:
                raise ValueError("Cannot decode PNG: image is too large")
        elif ctype == b"PLTE":
            if length % 3 or length == 0:
                raise ValueError("Cannot decode PNG: bad PLTE")
            palette = [
                (chunk[i], chunk[i + 1], chunk[i + 2]) for i in range(0, length, 3)
            ]
        elif ctype == b"IDAT":
            idat.extend(chunk)
        elif ctype == b"IEND":
            saw_iend = True
            break
        offset = end + 4

    if width is None or not idat or not saw_iend:
        raise ValueError("Cannot decode PNG: missing IHDR/IDAT/IEND")
    if interlace != 0:
        raise _NeedFallback("interlaced PNG")
    if color_type not in (0, 2, 3, 4, 6):
        raise ValueError("Cannot decode PNG: unsupported color type")
    if color_type == 3 and not palette:
        raise ValueError("Cannot decode PNG: indexed image has no PLTE")

    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    bits_pp = bit_depth * channels
    if bit_depth not in (1, 2, 4, 8, 16):
        raise ValueError("Cannot decode PNG: unsupported bit depth")
    if color_type in (2, 4, 6) and bit_depth not in (8, 16):
        raise ValueError("Cannot decode PNG: unsupported bit depth for color type")
    bpp = max(1, (bits_pp + 7) // 8)
    row_bytes = (width * bits_pp + 7) // 8

    try:
        raw = zlib.decompress(bytes(idat))
    except zlib.error as exc:
        raise ValueError(f"Cannot decode PNG: zlib failed ({exc})") from exc

    expected = height * (1 + row_bytes)
    if len(raw) < expected:
        raise ValueError("Cannot decode PNG: truncated image data")

    prev = bytearray(row_bytes)
    gray: list[array] = []
    chroma_acc = 0.0
    chroma_n = 0
    n_color = 1 if color_type in (0, 4) else 3
    src = 0
    for _r in range(height):
        filt = raw[src]
        scan = bytearray(raw[src + 1 : src + 1 + row_bytes])
        src += 1 + row_bytes
        _unfilter(filt, scan, prev, bpp)
        prev = scan
        samples = _unpack_samples(scan, width * channels, bit_depth)
        row, c_acc, c_n = _samples_to_gray(
            samples, width, color_type, bit_depth, palette
        )
        gray.append(row)
        chroma_acc += c_acc
        chroma_n += c_n

    chroma = chroma_acc / chroma_n if chroma_n else 0.0
    return gray, n_color, chroma


def _unfilter(filt: int, scan: bytearray, prev: bytearray, bpp: int) -> None:
    n = len(scan)
    if filt == 0:
        return
    if filt == 1:
        for i in range(n):
            left = scan[i - bpp] if i >= bpp else 0
            scan[i] = (scan[i] + left) & 255
        return
    if filt == 2:
        for i in range(n):
            scan[i] = (scan[i] + prev[i]) & 255
        return
    if filt == 3:
        for i in range(n):
            left = scan[i - bpp] if i >= bpp else 0
            scan[i] = (scan[i] + ((left + prev[i]) // 2)) & 255
        return
    if filt == 4:
        for i in range(n):
            left = scan[i - bpp] if i >= bpp else 0
            up = prev[i]
            ul = prev[i - bpp] if i >= bpp else 0
            scan[i] = (scan[i] + _paeth(left, up, ul)) & 255
        return
    raise ValueError(f"Cannot decode PNG: unknown filter type {filt}")


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def _unpack_samples(scan: bytearray, n_samples: int, bit_depth: int) -> list[int]:
    if bit_depth == 8:
        return list(scan[:n_samples])
    if bit_depth == 16:
        if len(scan) < n_samples * 2:
            raise ValueError("Cannot decode PNG: truncated scanline")
        out = []
        for i in range(0, n_samples * 2, 2):
            out.append(scan[i])
        return out
    mask = (1 << bit_depth) - 1
    per_byte = 8 // bit_depth
    out: list[int] = []
    for byte in scan:
        for s in range(per_byte):
            shift = 8 - bit_depth * (s + 1)
            out.append((byte >> shift) & mask)
            if len(out) >= n_samples:
                return out
    return out[:n_samples]


def _scale_gray(v: int, bit_depth: int) -> int:
    if bit_depth >= 8:
        return v
    mask = (1 << bit_depth) - 1
    return (v * 255) // mask if mask else 0


def _luma(r: int, g: int, b: int) -> int:
    return (77 * r + 150 * g + 29 * b) >> 8


def _samples_to_gray(
    samples: list[int],
    width: int,
    color_type: int,
    bit_depth: int,
    palette: list[tuple[int, int, int]] | None,
) -> tuple[array, float, int]:
    row = array("B", [0]) * width
    chroma_acc = 0.0
    chroma_n = 0
    if color_type == 0:
        for c in range(width):
            row[c] = _scale_gray(samples[c], bit_depth)
        return row, 0.0, 0
    if color_type == 4:
        for c in range(width):
            row[c] = _scale_gray(samples[c * 2], bit_depth)
        return row, 0.0, 0
    if color_type == 3:
        pal = palette or []
        n_pal = len(pal)
        for c in range(width):
            idx = samples[c]
            if idx >= n_pal:
                r = g = b = 0
            else:
                r, g, b = pal[idx]
            row[c] = _luma(r, g, b)
            mx = r if r > g else g
            if b > mx:
                mx = b
            mn = r if r < g else g
            if b < mn:
                mn = b
            chroma_acc += mx - mn
            chroma_n += 1
        return row, chroma_acc, chroma_n
    # RGB or RGBA
    step = 3 if color_type == 2 else 4
    for c in range(width):
        base = c * step
        r = _scale_gray(samples[base], bit_depth)
        g = _scale_gray(samples[base + 1], bit_depth)
        b = _scale_gray(samples[base + 2], bit_depth)
        row[c] = _luma(r, g, b)
        mx = r if r > g else g
        if b > mx:
            mx = b
        mn = r if r < g else g
        if b < mn:
            mn = b
        chroma_acc += mx - mn
        chroma_n += 1
    return row, chroma_acc, chroma_n


def _uf_find(parent: array, x: int) -> int:
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def _uf_union(parent: array, a: int, b: int) -> None:
    ra, rb = _uf_find(parent, a), _uf_find(parent, b)
    if ra != rb:
        parent[rb] = ra


def _largest_dark_blob(
    gray: list[array], k: float
) -> tuple[list[tuple[int, int]], dict[str, float]]:
    height = len(gray)
    width = len(gray[0])
    n = width * height
    total = 0
    total2 = 0
    for row in gray:
        for v in row:
            total += v
            total2 += v * v
    mean = total / n
    var = max(0.0, total2 / n - mean * mean)
    std = math.sqrt(var)
    stats = {"mean": mean, "std": std, "thr": mean - k * std, "blob_mean": mean}
    if std < 1e-9:
        return [], stats

    thr = mean - k * std
    mask = bytearray(n)
    for r, row in enumerate(gray):
        base = r * width
        for c, v in enumerate(row):
            if v < thr:
                mask[base + c] = 1

    ids = array("i", [-1]) * n
    uid = 0
    for i, flag in enumerate(mask):
        if flag:
            ids[i] = uid
            uid += 1
    if uid == 0:
        stats["thr"] = thr
        return [], stats

    parent = array("i", range(uid))
    for r in range(height):
        base = r * width
        for c in range(width):
            i = base + c
            if not mask[i]:
                continue
            a = ids[i]
            if c > 0 and mask[i - 1]:
                _uf_union(parent, a, ids[i - 1])
            if r > 0:
                up = i - width
                if mask[up]:
                    _uf_union(parent, a, ids[up])
                if c > 0 and mask[up - 1]:
                    _uf_union(parent, a, ids[up - 1])
                if c + 1 < width and mask[up + 1]:
                    _uf_union(parent, a, ids[up + 1])

    sizes: dict[int, int] = {}
    for i in range(n):
        if mask[i]:
            root = _uf_find(parent, ids[i])
            sizes[root] = sizes.get(root, 0) + 1

    min_size = max(8, min(64, n // 20000 or 8))
    eligible = {root: sz for root, sz in sizes.items() if sz >= min_size}
    pool = eligible if eligible else sizes
    best = max(pool, key=pool.get)

    pixels: list[tuple[int, int]] = []
    blob_sum = 0
    for r, row in enumerate(gray):
        base = r * width
        for c in range(width):
            i = base + c
            if mask[i] and _uf_find(parent, ids[i]) == best:
                pixels.append((r, c))
                blob_sum += row[c]

    pixels = _fill_holes(pixels)
    if pixels:
        blob_sum = sum(gray[r][c] for r, c in pixels)
        stats["blob_mean"] = blob_sum / len(pixels)
    stats["thr"] = thr
    return pixels, stats


def _fill_holes(pixels: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Fill 4-connected holes inside the blob bbox (does not expand outward)."""
    if not pixels:
        return pixels
    rmin = min(p[0] for p in pixels)
    rmax = max(p[0] for p in pixels)
    cmin = min(p[1] for p in pixels)
    cmax = max(p[1] for p in pixels)
    bh = rmax - rmin + 3
    bw = cmax - cmin + 3
    grid = bytearray(bh * bw)
    for r, c in pixels:
        lr = r - rmin + 1
        lc = c - cmin + 1
        grid[lr * bw + lc] = 1

    stack = []
    for x in range(bw):
        stack.append(x)
        stack.append((bh - 1) * bw + x)
    for y in range(bh):
        stack.append(y * bw)
        stack.append(y * bw + (bw - 1))
    seen = bytearray(bh * bw)
    while stack:
        i = stack.pop()
        if i < 0 or i >= bh * bw or seen[i] or grid[i]:
            continue
        seen[i] = 1
        y, x = divmod(i, bw)
        if x > 0:
            stack.append(i - 1)
        if x + 1 < bw:
            stack.append(i + 1)
        if y > 0:
            stack.append(i - bw)
        if y + 1 < bh:
            stack.append(i + bw)

    extra: list[tuple[int, int]] = []
    for y in range(1, bh - 1):
        for x in range(1, bw - 1):
            i = y * bw + x
            if grid[i] == 0 and not seen[i]:
                extra.append((y + rmin - 1, x + cmin - 1))
    if not extra:
        return pixels
    return pixels + extra


def _blob_polygon(
    pixels: list[tuple[int, int]],
    width: int,
    height: int,
    row_c: float,
    col_c: float,
) -> list[tuple[float, float]]:
    pix = set(pixels)
    boundary: list[tuple[int, int]] = []
    for r, c in pixels:
        if (
            r == 0
            or c == 0
            or r == height - 1
            or c == width - 1
            or (r - 1, c) not in pix
            or (r + 1, c) not in pix
            or (r, c - 1) not in pix
            or (r, c + 1) not in pix
        ):
            boundary.append((r, c))
    if len(boundary) < 3:
        return _circle_rc(row_c, col_c, 1.5, 12)

    n_bins = 24
    best: list[tuple[float, float, float] | None] = [None] * n_bins
    two_pi = 2.0 * math.pi
    for r, c in boundary:
        ang = math.atan2((r + 0.5) - row_c, (c + 0.5) - col_c)
        b = int((ang + math.pi) / two_pi * n_bins) % n_bins
        d2 = ((r + 0.5) - row_c) ** 2 + ((c + 0.5) - col_c) ** 2
        cur = best[b]
        if cur is None or d2 > cur[0]:
            best[b] = (d2, r + 0.5, c + 0.5)

    pts = [(item[1], item[2]) for item in best if item is not None]
    pts.sort(key=lambda p: math.atan2(p[0] - row_c, p[1] - col_c))
    if len(pts) < 3:
        return _circle_rc(row_c, col_c, 1.5, 12)
    pts = _simplify_ring(pts)
    if len(pts) < MIN_POLY:
        pts = _densify_rc(pts, MIN_POLY)
    if len(pts) > MAX_POLY:
        pts = _even_sample(pts, MAX_POLY)
    return pts


def _circle_rc(
    row_c: float, col_c: float, radius: float, n: int
) -> list[tuple[float, float]]:
    n = max(MIN_POLY, min(MAX_POLY, n))
    out = []
    for i in range(n):
        a = 2.0 * math.pi * i / n
        out.append((row_c + radius * math.sin(a), col_c + radius * math.cos(a)))
    return out


def _point_seg_dist(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> float:
    dx, dy = bx - ax, by - ay
    if dx == 0.0 and dy == 0.0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = 0.0 if t < 0.0 else 1.0 if t > 1.0 else t
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _rdp(points: list[tuple[float, float]], epsilon: float) -> list[tuple[float, float]]:
    if len(points) < 3:
        return list(points)
    ax, ay = points[0]
    bx, by = points[-1]
    max_d = -1.0
    idx = 0
    for i in range(1, len(points) - 1):
        d = _point_seg_dist(points[i][0], points[i][1], ax, ay, bx, by)
        if d > max_d:
            max_d = d
            idx = i
    if max_d > epsilon:
        left = _rdp(points[: idx + 1], epsilon)
        right = _rdp(points[idx:], epsilon)
        return left[:-1] + right
    return [points[0], points[-1]]


def _simplify_ring(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if len(pts) <= MAX_POLY:
        return pts
    closed = pts + [pts[0]]
    lo, hi = 0.0, 1.0
    for p in pts:
        hi = max(hi, abs(p[0]) + abs(p[1]) + 1.0)
    best = pts
    for _ in range(24):
        mid = (lo + hi) / 2.0
        simp = _rdp(closed, mid)
        if len(simp) >= 2 and simp[0] == simp[-1]:
            simp = simp[:-1]
        if len(simp) > MAX_POLY:
            lo = mid
        else:
            best = simp if len(simp) >= 3 else best
            hi = mid
    if len(best) > MAX_POLY:
        best = _even_sample(best, MAX_POLY)
    return best


def _densify_rc(
    pts: list[tuple[float, float]], n: int
) -> list[tuple[float, float]]:
    pts = list(pts)
    if not pts:
        return pts
    guard = 0
    while len(pts) < n and guard < 64:
        guard += 1
        best_i = 0
        best_d = -1.0
        m = len(pts)
        for i in range(m):
            r0, c0 = pts[i]
            r1, c1 = pts[(i + 1) % m]
            d = (r0 - r1) ** 2 + (c0 - c1) ** 2
            if d > best_d:
                best_d = d
                best_i = i
        r0, c0 = pts[best_i]
        r1, c1 = pts[(best_i + 1) % m]
        pts.insert(best_i + 1, ((r0 + r1) / 2.0, (c0 + c1) / 2.0))
    return pts


def _densify_ll(pts: list[list[float]], n: int) -> list[list[float]]:
    pairs = [(p[0], p[1]) for p in pts]
    pairs = _densify_rc(pairs, n)
    return [[a, b] for a, b in pairs]


def _even_sample(pts: list, n: int) -> list:
    m = len(pts)
    if m <= n or n < 3:
        return list(pts)
    lengths = [0.0] * m
    total = 0.0
    for i in range(m):
        a, b = pts[i], pts[(i + 1) % m]
        if isinstance(a, (list, tuple)):
            d = math.hypot(float(a[0]) - float(b[0]), float(a[1]) - float(b[1]))
        else:
            d = 0.0
        total += d
        lengths[i] = total
    if total <= 0.0:
        step = m / n
        return [pts[min(m - 1, int(i * step))] for i in range(n)]
    out = []
    target = 0.0
    j = 0
    for i in range(n):
        target = (i * total) / n
        while j < m - 1 and lengths[j] < target:
            j += 1
        out.append(pts[j])
    return out


def _self_check() -> None:
    preview = Path(__file__).resolve().parent.parent / "data" / "demo" / "sar_preview.png"
    if not preview.is_file():
        print("no demo preview")
        return
    bounds: Any = [[18.5, 71.7], [18.8, 72.2]]
    case_path = preview.parent / "case_001.json"
    if case_path.is_file():
        try:
            case = json.loads(case_path.read_text(encoding="utf-8"))
            bounds = (case.get("sar") or {}).get("bounds") or bounds
        except (OSError, json.JSONDecodeError, TypeError, AttributeError):
            pass
    out = detect_slick(preview.read_bytes(), bounds)
    print("centroid", out["centroid"], "area_km2", out["area_km2"])


if __name__ == "__main__":
    _self_check()
