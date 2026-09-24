"""Deterministic honesty / leakage checks. No GPU. Never opens Part III TIFFs.

Run:
  python backend/ml/honesty_check.py
  python backend/ml/honesty_check.py --session-start
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
ML = ROOT / "backend" / "ml"
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend" / "src"
OCEAN_UI = ROOT / "oceantrace_frontend" / "src"
MODELS = BACKEND / "models"

SEVERE = "fail"
WARN = "warn"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace") if path.is_file() else ""


def _add(findings: list[dict], check: str, status: str, detail: str, path: str | None = None) -> None:
    findings.append({"check": check, "status": status, "detail": detail, "path": path})


def check_part3_not_in_train(findings: list[dict]) -> None:
    forbidden = re.compile(
        r"zenodo[/\\]+Images|data[/\\]+zenodo[/\\]+Images",
        re.I,
    )
    train_files = [
        ML / "train.py",
        ML / "dataset.py",
        ML / "trim_and_tile.py",
        ML / "tile_part2.py",
        ML / "shrink_and_tile.py",
        ML / "calibrate.py",
    ]
    for path in train_files:
        text = _read(path)
        if not path.is_file():
            _add(findings, "part3_train_leak", SEVERE, f"missing {path.name}", str(path))
            continue
        if forbidden.search(text) and "assert_not_part3" not in text and "is_part3_path" not in text:
            _add(
                findings,
                "part3_train_leak",
                SEVERE,
                f"{path.name} mentions zenodo/Images without a Part 3 guard",
                str(path),
            )
        elif forbidden.search(text) and path.name == "calibrate.py":
            _add(findings, "part3_train_leak", "pass", "calibrate.py mentions Part 3 only to refuse it", str(path))
        else:
            _add(findings, "part3_train_leak", "pass", f"{path.name} does not train on Part 3", str(path))


def check_eval_frozen(findings: list[dict]) -> None:
    path = ML / "eval_part3.py"
    text = _read(path)
    if not text:
        _add(findings, "eval_part3_frozen", SEVERE, "eval_part3.py missing", str(path))
        return
    if "resize" in text.lower() and "Image.NEAREST" in text:
        _add(findings, "eval_no_silent_resize", SEVERE, "eval_part3.py still silently resizes predictions", str(path))
    else:
        _add(findings, "eval_no_silent_resize", "pass", "no silent prediction resize", str(path))
    if "accepts no arguments" in text or "no operating-point overrides" in text:
        _add(findings, "eval_part3_frozen", "pass", "eval_part3.py rejects CLI overrides", str(path))
    else:
        _add(findings, "eval_part3_frozen", WARN, "eval_part3.py should refuse threshold CLI overrides", str(path))
    if "2500" in text and "false" in text.lower():
        _add(findings, "no_gamed_false_alarm", SEVERE, "eval_part3.py looks like it redefines scene FAs by area", str(path))
    else:
        _add(findings, "no_gamed_false_alarm", "pass", "no 2500px scene-FA redefinition in eval_part3.py", str(path))


def check_detect_threshold(findings: list[dict]) -> None:
    detect = _read(BACKEND / "detect.py")
    predict = _read(ML / "predict.py")
    if "threshold=0.5" in detect:
        _add(
            findings,
            "detect_threshold_aligned",
            SEVERE,
            "detect.py still hardcodes threshold=0.5; Upload must use predict defaults",
            str(BACKEND / "detect.py"),
        )
    else:
        _add(findings, "detect_threshold_aligned", "pass", "detect.py uses predict_mask defaults", str(BACKEND / "detect.py"))
    if "THRESHOLD_MODE" in predict and 'THRESHOLD_MODE = "single"' in predict:
        _add(findings, "hysteresis_default_off", "pass", "hysteresis is off until Part 1/2 calibration", str(ML / "predict.py"))
    if "pad_for_tiles" in predict and "gaussian_tile_weight" in predict:
        _add(findings, "gaussian_pad_stitch", "pass", "predict.py pads short axes and Gaussian-stitches", str(ML / "predict.py"))
    else:
        _add(findings, "gaussian_pad_stitch", SEVERE, "predict.py missing pad/gaussian stitch helpers", str(ML / "predict.py"))


def check_analyze_no_detect(findings: list[dict]) -> None:
    text = _read(BACKEND / "main.py")
    if '"detect": False' in text or '"detect": false' in text:
        _add(findings, "map_analyze_no_unet", "pass", "Map analyze does not re-detect SAR", str(BACKEND / "main.py"))
    else:
        _add(findings, "map_analyze_no_unet", WARN, "could not confirm pipeline.detect=False on analyze", str(BACKEND / "main.py"))
    if "RGB holiday photos are not Sentinel-1" in text or "not Sentinel-1 SAR" in text:
        _add(findings, "jpeg_rejected", "pass", "upload rejects JPEG as non-SAR", str(BACKEND / "main.py"))
    else:
        _add(findings, "jpeg_rejected", WARN, "investigate endpoint should reject JPEG/WebP", str(BACKEND / "main.py"))


def check_stale_metrics(findings: list[dict]) -> None:
    part3 = MODELS / "oil_unet_part3_test.json"
    if part3.is_file():
        data = json.loads(part3.read_text(encoding="utf-8"))
        rec = float(data.get("oil", {}).get("recall") or 0)
        if abs(rec - 0.679) < 0.01:
            _add(
                findings,
                "part3_json_present",
                "pass",
                f"Part 3 oil recall in JSON is {rec:.3f} (historical, already-consulted)",
                str(part3),
            )
        else:
            _add(findings, "part3_json_present", "pass", f"Part 3 oil recall in JSON is {rec:.3f}", str(part3))
    current_claim = re.compile(
        r"(independent val|current|active).{0,40}0\.881|Dice\s*\*?\*?0\.881",
        re.I,
    )
    retired = re.compile(r"retired|leaky|do not quote 0\.881", re.I)
    for rel in ("SIH.md", "STATUS.md"):
        path = ROOT / rel
        text = _read(path)
        if not text:
            continue
        if "0.881" in text and current_claim.search(text) and not retired.search(text):
            _add(
                findings,
                "stale_0881",
                SEVERE,
                f"{rel} presents Dice 0.881 as a current score (leaky tile split)",
                str(path),
            )
        elif "0.881" in text and retired.search(text):
            _add(
                findings,
                "stale_0881",
                "pass",
                f"{rel} mentions 0.881 only as the retired leaky split",
                str(path),
            )
        elif "0.881" in text:
            _add(
                findings,
                "stale_0881",
                WARN,
                f"{rel} still mentions 0.881 without calling it retired",
                str(path),
            )
        else:
            _add(findings, "stale_0881", "pass", f"{rel} does not quote 0.881", str(path))


def check_fake_live(findings: list[dict]) -> None:
    live = re.compile(r"All Systems Online|NTRO Secure Mode|(?<!not )operational NTRO", re.I)
    denial = re.compile(
        r"no LIVE|not (an )?operational|not NTRO operational|not operational NTRO",
        re.I,
    )
    for folder, label in ((FRONTEND, "frontend"), (OCEAN_UI, "oceantrace_frontend/src")):
        if not folder.is_dir():
            continue
        hits = []
        for path in folder.rglob("*"):
            if path.suffix.lower() not in {".js", ".ts", ".css", ".html"}:
                continue
            text = _read(path)
            if live.search(text) and not denial.search(text):
                hits.append(str(path.relative_to(ROOT)))
        if hits:
            _add(findings, "no_fake_live", SEVERE, f"LIVE/NTRO-theatre strings in {label}: {hits[:5]}", hits[0])
        else:
            _add(findings, "no_fake_live", "pass", f"no fake LIVE/NTRO-secure theatre in {label}")


def check_guard_module(findings: list[dict]) -> None:
    path = ML / "part3_guard.py"
    if path.is_file() and "Part3ForbiddenError" in _read(path):
        _add(findings, "part3_guard", "pass", "part3_guard.py present", str(path))
    else:
        _add(findings, "part3_guard", SEVERE, "part3_guard.py missing", str(path))
    cal = _read(ML / "calibrate.py")
    if "assert_not_part3" in cal:
        _add(findings, "calibrate_refuses_part3", "pass", "calibrate.py refuses Part 3 paths", str(ML / "calibrate.py"))
    else:
        _add(findings, "calibrate_refuses_part3", SEVERE, "calibrate.py has no Part 3 guard", str(ML / "calibrate.py"))


def run_checks() -> list[dict]:
    findings: list[dict] = []
    check_guard_module(findings)
    check_part3_train_leak = check_part3_not_in_train
    check_part3_train_leak(findings)
    check_eval_frozen(findings)
    check_detect_threshold(findings)
    check_analyze_no_detect(findings)
    check_stale_metrics(findings)
    check_fake_live(findings)
    return findings


def summarize(findings: list[dict]) -> tuple[int, int]:
    fails = sum(1 for f in findings if f["status"] == SEVERE)
    warns = sum(1 for f in findings if f["status"] == WARN)
    return fails, warns


def format_report(findings: list[dict]) -> str:
    fails, warns = summarize(findings)
    lines = [f"HONESTY {'FAIL' if fails else 'PASS'}  fails={fails} warns={warns} checks={len(findings)}"]
    for f in findings:
        if f["status"] == "pass":
            continue
        mark = "FAIL" if f["status"] == SEVERE else "WARN"
        lines.append(f"  {mark} {f['check']}: {f['detail']}")
    if fails == 0 and warns == 0:
        lines.append("  all checks passed")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-start", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    findings = run_checks()
    fails, warns = summarize(findings)
    report = format_report(findings)
    if args.json:
        print(json.dumps({"fails": fails, "warns": warns, "findings": findings}, indent=2))
    elif args.session_start:
        extra = report if fails or warns else f"HONESTY PASS ({len(findings)} checks). Part III is test-only."
        payload = {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": extra,
            }
        }
        print(json.dumps(payload))
    else:
        print(report)
        for f in findings:
            if f["status"] == "pass":
                print(f"  ok   {f['check']}: {f['detail']}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
