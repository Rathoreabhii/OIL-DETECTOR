"""Part III is a frozen test set. Training and calibration must never read it."""
from __future__ import annotations

from pathlib import Path

PART3_IMAGE_DIRNAME = "images"
PART3_MASK_DIRNAME = "mask"
PART3_MASK_CLASSES = frozenset({"oil", "lookalike", "no oil", "no_oil"})


class Part3ForbiddenError(ValueError):
    """Raised when a path points at Zenodo Part III (test-only)."""


def is_part3_path(path: str | Path) -> bool:
    """True for data/zenodo/Images/... or data/zenodo/Mask/{Oil,Lookalike,No oil}/..."""
    parts = [p.lower() for p in Path(path).parts]
    for i, part in enumerate(parts):
        if part != "zenodo" or i + 1 >= len(parts):
            continue
        nxt = parts[i + 1]
        if nxt == PART3_IMAGE_DIRNAME:
            return True
        if nxt == PART3_MASK_DIRNAME and i + 2 < len(parts) and parts[i + 2] in PART3_MASK_CLASSES:
            return True
    return False


def assert_not_part3(path: str | Path, *, role: str = "path") -> Path:
    resolved = Path(path).expanduser()
    try:
        resolved = resolved.resolve()
    except OSError:
        pass
    if is_part3_path(resolved):
        raise Part3ForbiddenError(
            f"{role} is Zenodo Part III (test-only) and cannot be used for "
            f"train/val/calibration: {resolved}"
        )
    return resolved
