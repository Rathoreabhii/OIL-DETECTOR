"""Build scene-disjoint train / model_val / calibration manifests (Part 1/2 only).

Never touches Part III. Run before full retrain:
  python backend/ml/make_manifests.py --dry-run
  python backend/ml/make_manifests.py --run

Writes backend/models/split_manifest.json with SHA + scene lists.
train.py picks checkpoint on model_val (threshold-free intent).
calibrate.py --run picks operating point on calibration only.
"""
from __future__ import annotations
import argparse, hashlib, json, random, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "backend" / "ml"))
from config import PROCESSED_DIR, MODELS_DIR, SEED
from dataset import scene_id
from part3_guard import assert_not_part3

VAL_FRAC = 0.15
CAL_FRAC = 0.15

def collect():
    img_dir = PROCESSED_DIR / "images"
    files = sorted(f.name for f in img_dir.glob("*.png"))
    by_scene: dict[str, list[str]] = {}
    for n in files:
        by_scene.setdefault(scene_id(n), []).append(n)
    fams: dict[str, list[str]] = {"oil": [], "look": [], "noil": []}
    for sid in by_scene:
        k = "look" if sid.startswith("look_") else "noil" if sid.startswith("noil_") else "oil"
        fams[k].append(sid)
    return by_scene, fams

def split_family(scenes: list[str], seed: int):
    rng = random.Random(seed)
    s = scenes[:]; rng.shuffle(s)
    n = len(s)
    n_val = max(1 if n > 2 else 0, int(round(n * VAL_FRAC)))
    n_cal = max(1 if n > 3 else 0, int(round(n * CAL_FRAC)))
    cal = s[:n_cal]; val = s[n_cal:n_cal+n_val]; tr = s[n_cal+n_val:]
    return tr, val, cal

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    by_scene, fams = collect()
    # guard: processed dir must never contain Part3
    for sid, tiles in by_scene.items():
        for t in tiles:
            assert_not_part3(PROCESSED_DIR / "images" / t, role="tile")
    out = {"train": [], "model_val": [], "calibration": []}
    for i, (fam, scenes) in enumerate(fams.items()):
        tr, va, ca = split_family(scenes, SEED + 10 + i)
        # scene-disjoint check
        assert not (set(tr) & set(va) & set(ca) - set()) or True
        assert not (set(tr) & set(va) or set(tr) & set(ca) or set(va) & set(ca)), f"overlap in {fam}"
        out["train"] += tr; out["model_val"] += va; out["calibration"] += ca
        print(f"{fam}: train {len(tr)} val {len(va)} cal {len(ca)} scenes")
    h = hashlib.sha256(json.dumps(out, sort_keys=True).encode()).hexdigest()[:12]
    print(f"scenes total {sum(len(v) for v in out.values())} hash {h}")
    if a.run and not a.dry_run:
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        (MODELS_DIR / "split_manifest.json").write_text(json.dumps({"hash": h, **out}, indent=2))
        print("Wrote backend/models/split_manifest.json")
    else:
        print("dry-run only. Pass --run to write.")

if __name__ == "__main__":
    main()
