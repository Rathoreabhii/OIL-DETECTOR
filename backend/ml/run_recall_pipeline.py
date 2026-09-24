"""Fine-tune from the epoch-15 backup, then calibrate. Part III runs only if calibration wins.

Training never reads data/zenodo/Images. eval_part3.py is the only Part III entry,
and only after the new weights beat the backup on manifest calibration scenes.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
ML = ROOT / "backend" / "ml"
MODELS = ROOT / "backend" / "models"
PY = sys.executable


def _run(args: list[str]) -> None:
    print(">>", " ".join(args), flush=True)
    completed = subprocess.run(args, cwd=str(ROOT))
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def _selected(path: Path) -> dict | None:
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8")).get("selected")


def _patch_predict(selected: dict) -> None:
    path = ML / "predict.py"
    text = path.read_text(encoding="utf-8")
    blob = int(selected["min_blob_px"])
    mode = selected["mode"]
    lines = []
    for line in text.splitlines(keepends=True):
        stripped = line.lstrip()
        if stripped.startswith("DEFAULT_THRESHOLD = ") and mode == "single":
            line = f"DEFAULT_THRESHOLD = {float(selected['threshold'])}\n"
        elif stripped.startswith("MIN_BLOB_PX = "):
            line = f"MIN_BLOB_PX = {blob}\n"
        elif stripped.startswith("THRESHOLD_MODE = "):
            line = f'THRESHOLD_MODE = "{mode}"  # frozen from manifest calibration\n'
        elif stripped.startswith("HYST_LOW = ") and mode == "hysteresis":
            line = f"HYST_LOW = {float(selected['low'])}\n"
        elif stripped.startswith("HYST_HIGH = ") and mode == "hysteresis":
            line = f"HYST_HIGH = {float(selected['high'])}\n"
        lines.append(line)
    path.write_text("".join(lines), encoding="utf-8")


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "resume":
        start = sys.argv[2] if len(sys.argv) > 2 else "23"
        _run([PY, "-u", str(ML / "train.py"), "resume", start])
    else:
        epochs = sys.argv[1] if len(sys.argv) > 1 else "25"
        _run([PY, "-u", str(ML / "train.py"), epochs])

    metrics_path = MODELS / "oil_unet_metrics_gamma0.json"
    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    if not metrics.get("improved"):
        print("NO_PROMOTION no epoch beat the epoch-15 fringe baseline", flush=True)
        print("PIPELINE_DONE_NO_PROMOTION", flush=True)
        return

    backup_out = MODELS / "calibration_backup_run2_manifest.json"
    new_out = MODELS / "calibration_gamma0_manifest.json"
    _run(
        [
            PY,
            "-u",
            str(ML / "calibrate.py"),
            "--run",
            "--checkpoint",
            str(MODELS / "oil_unet_backup_run2.pt"),
            "--out",
            str(backup_out),
            "--max-per-family",
            "0",
        ]
    )
    _run(
        [
            PY,
            "-u",
            str(ML / "calibrate.py"),
            "--run",
            "--checkpoint",
            str(MODELS / "oil_unet_gamma0.pt"),
            "--out",
            str(new_out),
            "--max-per-family",
            "0",
        ]
    )
    old = _selected(backup_out)
    new = _selected(new_out)
    if not old or not new:
        print("NO_PROMOTION no operating point met pooled precision 0.85", flush=True)
        print("PIPELINE_DONE_NO_PROMOTION", flush=True)
        return
    print("OLD", json.dumps(old), flush=True)
    print("NEW", json.dumps(new), flush=True)
    better_edge = float(new["boundary_recall"]) > float(old["boundary_recall"]) + 0.01
    recall_held = float(new["recall"]) >= float(old["recall"]) - 0.01
    if not (better_edge and recall_held):
        print("NO_PROMOTION calibration fringe did not improve enough", flush=True)
        print("PIPELINE_DONE_NO_PROMOTION", flush=True)
        return

    archive = MODELS / "oil_unet_part3_test_30ep_54recall.json"
    current = MODELS / "oil_unet_part3_test.json"
    if current.is_file() and not archive.is_file():
        shutil.copy2(current, archive)
        print("Archived previous Part 3 json to", archive.name, flush=True)
    shutil.copy2(MODELS / "oil_unet_gamma0.pt", MODELS / "oil_unet.pt")
    _patch_predict(new)
    print("Promoted gamma0 weights. One frozen Part 3 eval.", flush=True)
    _run([PY, "-u", str(ML / "eval_part3.py")])
    print("PIPELINE_OK", flush=True)


if __name__ == "__main__":
    main()
