import json
import math
import sys
import time
from pathlib import Path
import torch
import torch.nn.functional as F
from tqdm import tqdm

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
sys.stderr.reconfigure(encoding='utf-8', line_buffering=True)

# Ensure backend/ml is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import (
    MODELS_DIR,
    NUM_EPOCHS,
    LEARNING_RATE,
    WEIGHT_DECAY,
    AMP_ENABLED,
    BATCH_SIZE,
    TILE_SIZE,
    HOST_RAM_GB,
    HOST_VRAM_GB,
    PROCESSED_DIR,
)
from dataset import MANIFEST_HASH, get_manifest_dataloaders
from model import build_model, TverskyFocalLoss, calculate_metrics
from part3_guard import assert_not_part3

FOCAL_GAMMA = 0.0
TVERSKY_ALPHA = 0.7
TVERSKY_BETA = 0.3
TVERSKY_WEIGHT = 0.6
INIT_NAME = "oil_unet_backup_run2.pt"
OUT_NAME = "oil_unet_gamma0.pt"
PRECISION_DROP_LIMIT = 0.03


def _logits_and_loss(model, images, masks, criterion, device):
    """Forward in AMP. Loss in fp32 so Tversky sums do not underflow."""
    if AMP_ENABLED and device == "cuda":
        with torch.amp.autocast("cuda"):
            logits = model(images)
    else:
        logits = model(images)
    loss = criterion(logits.float(), masks.float())
    return logits, loss


def _boundary(masks: torch.Tensor) -> torch.Tensor:
    """Oil pixels that a 7x7 erosion removes. Those are the fringe the test misses."""
    eroded = 1.0 - F.max_pool2d(1.0 - masks, kernel_size=7, stride=1, padding=3)
    return (masks - eroded).clamp(min=0.0)


def train_one_epoch(model, loader, optimizer, criterion, scaler, device):
    model.train()
    running_loss = 0.0
    running_iou = 0.0
    running_dice = 0.0

    pbar = tqdm(loader, desc="Training", leave=False)
    for images, masks in pbar:
        images = images.to(device, non_blocking=True)
        masks = masks.to(device, non_blocking=True)

        optimizer.zero_grad(set_to_none=True)
        logits, loss = _logits_and_loss(model, images, masks, criterion, device)
        if not math.isfinite(float(loss.item())):
            raise SystemExit("Loss is NaN")
        if AMP_ENABLED and device == "cuda":
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(optimizer)
            scaler.update()
        else:
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

        iou, dice = calculate_metrics(logits.float(), masks)
        running_loss += loss.item()
        running_iou += iou
        running_dice += dice

        pbar.set_postfix({"loss": f"{loss.item():.4f}", "iou": f"{iou:.3f}", "dice": f"{dice:.3f}"})

    n = len(loader)
    return running_loss / n, running_iou / n, running_dice / n


def validate(model, loader, criterion, device):
    model.eval()
    running_loss = 0.0
    running_iou = 0.0
    running_dice = 0.0
    tp = fp = fn = 0.0
    soft_tp = soft_fp = soft_fn = 0.0
    bound_tp = bound_fn = 0.0

    with torch.no_grad():
        for images, masks in loader:
            images = images.to(device, non_blocking=True)
            masks = masks.to(device, non_blocking=True)
            logits, loss = _logits_and_loss(model, images, masks, criterion, device)
            if not math.isfinite(float(loss.item())):
                raise SystemExit("Validation loss is NaN")

            iou, dice = calculate_metrics(logits.float(), masks)
            running_loss += loss.item()
            running_iou += iou
            running_dice += dice

            probs = torch.sigmoid(logits.float())
            preds = (probs > 0.5).float()
            tp += (preds * masks).sum().item()
            fp += (preds * (1.0 - masks)).sum().item()
            fn += ((1.0 - preds) * masks).sum().item()
            soft_tp += (probs * masks).sum().item()
            soft_fp += (probs * (1.0 - masks)).sum().item()
            soft_fn += ((1.0 - probs) * masks).sum().item()
            boundary = _boundary(masks)
            bound_tp += (probs * boundary).sum().item()
            bound_fn += ((1.0 - probs) * boundary).sum().item()

    n = max(len(loader), 1)
    rec = tp / (tp + fn + 1e-9)
    prec = tp / (tp + fp + 1e-9)
    g_dice = (2.0 * tp) / (2.0 * tp + fp + fn + 1e-9)
    g_iou = tp / (tp + fp + fn + 1e-9)
    soft_tversky = (soft_tp + 1e-6) / (
        soft_tp + TVERSKY_ALPHA * soft_fn + TVERSKY_BETA * soft_fp + 1e-6
    )
    return {
        "loss": running_loss / n,
        "batch_iou": running_iou / n,
        "batch_dice": running_dice / n,
        "global_dice": g_dice,
        "global_iou": g_iou,
        "recall": rec,
        "precision": prec,
        "soft_recall": soft_tp / (soft_tp + soft_fn + 1e-9),
        "soft_precision": soft_tp / (soft_tp + soft_fp + 1e-9),
        "soft_tversky": soft_tversky,
        "boundary_soft_recall": bound_tp / (bound_tp + bound_fn + 1e-9),
        "tp": int(tp),
        "fp": int(fp),
        "fn": int(fn),
    }


def _beats_baseline(candidate: dict, baseline: dict) -> bool:
    """Keep an epoch only when the fringe score rises and precision does not collapse.

    Soft recall alone is not enough: predicting oil everywhere scores 1.0.
    """
    if candidate["boundary_soft_recall"] <= baseline["boundary_soft_recall"]:
        return False
    if candidate["soft_precision"] < baseline["soft_precision"] - PRECISION_DROP_LIMIT:
        return False
    return True


def lookalike_fp_rate(model, val_files, device, max_tiles=80) -> dict[str, float] | None:
    """Mean predicted-oil fraction on val look_* tiles at 0.5 and at the live 0.15 cutoff."""
    from PIL import Image
    import numpy as np

    looks = [f for f in val_files if f.startswith("look_")][:max_tiles]
    if not looks:
        return None
    img_dir = PROCESSED_DIR / "images"
    at_50: list[float] = []
    at_15: list[float] = []
    model.eval()
    with torch.no_grad():
        for name in looks:
            arr = np.array(Image.open(img_dir / name).convert("L"), dtype=np.float32) / 255.0
            tensor = torch.from_numpy(arr).unsqueeze(0).unsqueeze(0).to(device)
            probs = torch.sigmoid(model(tensor).float())
            at_50.append(float((probs > 0.5).float().mean().item()))
            at_15.append(float((probs > 0.15).float().mean().item()))
    return {"at_0.5": float(sum(at_50) / len(at_50)), "at_0.15": float(sum(at_15) / len(at_15))}


def main():
    print("=" * 65)
    print("       SAR OIL SPILL U-NET TRAINING PIPELINE (SIH 26143)")
    print("=" * 65)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[*] Compute Device: {device.upper()}")
    print(f"[*] Laptop caps: {HOST_RAM_GB} GB RAM, {HOST_VRAM_GB} GB VRAM (do not exceed)")
    if BATCH_SIZE > 8 or TILE_SIZE > 512 or not AMP_ENABLED:
        print(
            f"[!] Config exceeds this laptop: batch={BATCH_SIZE}, tile={TILE_SIZE}, AMP={AMP_ENABLED}. "
            "Keep batch<=8, 512 tiles, AMP on."
        )
    if device == "cuda":
        gpu_name = torch.cuda.get_device_name(0)
        vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        print(f"[*] GPU: {gpu_name} ({vram_gb:.1f} GB VRAM)")
        print(f"[*] Mixed Precision (AMP): {'Enabled' if AMP_ENABLED else 'Disabled'}")
        if vram_gb + 0.3 < HOST_VRAM_GB:
            print(f"[!] GPU reports {vram_gb:.1f} GB; config HOST_VRAM_GB={HOST_VRAM_GB}")

    batch = BATCH_SIZE
    if device == "cuda":
        free = torch.cuda.get_device_properties(0).total_memory - torch.cuda.memory_allocated()
        free_gb = free / (1024**3)
        print(f"[*] Free VRAM ~{free_gb:.2f} GB")
        if free_gb < 3.5 and batch > 4:
            batch = 4
            print("[!] Low free VRAM — batch 4 (still AMP, 512)")

    assert_not_part3(PROCESSED_DIR / "images", role="training tiles")
    train_loader, val_loader, val_files = get_manifest_dataloaders(batch_size=batch)

    model = build_model(device=device, pretrained=False)
    resume = len(sys.argv) > 1 and sys.argv[1] == "resume"
    refused = [MODELS_DIR / "oil_unet_part1.pt", MODELS_DIR / "oil_unet_new_30ep_54recall.pt"]
    if resume:
        src = MODELS_DIR / OUT_NAME
    else:
        src = MODELS_DIR / INIT_NAME
    if any(src.resolve() == path.resolve() for path in refused if path.is_file()):
        raise SystemExit(f"refusing to initialize from {src.name}")
    if not src.is_file():
        raise SystemExit(f"missing init checkpoint {src}")
    ck = torch.load(src, map_location=device, weights_only=False)
    if resume:
        if int(ck.get("epoch", -1)) < 1:
            raise SystemExit(f"refusing resume: {src.name} has no trained epoch")
    elif int(ck.get("epoch", -1)) != 15:
        raise SystemExit(f"refusing init epoch {ck.get('epoch')}; want epoch 15 in {INIT_NAME}")
    model.load_state_dict(ck["model_state_dict"])
    print(f"[*] Initialized from {src.name} epoch {ck.get('epoch')}. Not part1. Not the 30-epoch file. Not oil_unet.pt.")
    criterion = TverskyFocalLoss(
        alpha=TVERSKY_ALPHA,
        beta=TVERSKY_BETA,
        focal_gamma=FOCAL_GAMMA,
        tversky_weight=TVERSKY_WEIGHT,
    )
    optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY)
    if resume and "optimizer_state_dict" in ck:
        optimizer.load_state_dict(ck["optimizer_state_dict"])
    num_epochs = 25 if resume else (int(sys.argv[1]) if len(sys.argv) > 1 else 25)
    if resume and len(sys.argv) > 2:
        start_epoch = int(sys.argv[2])
    else:
        start_epoch = int(ck["epoch"]) + 1 if resume else 1
    if start_epoch > num_epochs:
        raise SystemExit(f"nothing to resume: start {start_epoch} is past {num_epochs}")
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="max", factor=0.5, patience=4)
    scaler = torch.amp.GradScaler("cuda", enabled=(AMP_ENABLED and device == "cuda"))

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    best_model_path = MODELS_DIR / OUT_NAME
    metrics_path = MODELS_DIR / "oil_unet_metrics_gamma0.json"
    log_path = MODELS_DIR / "oil_unet_gamma0_log.jsonl"
    if best_model_path.resolve() == (MODELS_DIR / "oil_unet.pt").resolve():
        raise SystemExit("refusing to write the live oil_unet.pt during training")

    if resume:
        prior = json.loads(metrics_path.read_text(encoding="utf-8"))
        baseline = prior["baseline"]
        best_boundary = float(prior["best"]["boundary_soft_recall"])
        improved = True
        print(
            f"[*] Resuming at epoch {start_epoch}/{num_epochs} from saved epoch {ck.get('epoch')} "
            f"boundary={best_boundary:.4f}. Epochs 19-22 were not stored."
        )
    else:
        print("[*] Scoring epoch 0 (loaded backup) before any weight update...")
        baseline = validate(model, val_loader, criterion, device)
        best_boundary = float(baseline["boundary_soft_recall"])
        improved = False
        print(
            f"Epoch [00/{num_epochs:02d}] baseline boundary_soft_recall={baseline['boundary_soft_recall']:.4f} "
            f"soft_precision={baseline['soft_precision']:.4f} soft_tversky={baseline['soft_tversky']:.4f} "
            f"dice@0.5={baseline['global_dice']:.4f}"
        )

    def _public(row: dict) -> dict:
        return {key: (float(val) if isinstance(val, float) else val) for key, val in row.items()}

    def _write_metrics(best_row: dict | None) -> None:
        body = {
            "init": INIT_NAME,
            "init_epoch": 15,
            "focal_gamma": FOCAL_GAMMA,
            "tversky_alpha": TVERSKY_ALPHA,
            "tversky_beta": TVERSKY_BETA,
            "tversky_weight": TVERSKY_WEIGHT,
            "learning_rate": LEARNING_RATE,
            "manifest_hash": MANIFEST_HASH,
            "selection": "boundary_soft_recall with soft_precision veto; tile dice at 0.5 is logged only",
            "baseline": _public(baseline),
            "improved": improved,
            "best": best_row,
            "pol": "index1_VV_dimap",
            "part3_used": False,
        }
        metrics_path.write_text(json.dumps(body, indent=2), encoding="utf-8")

    if resume:
        best_public = json.loads(metrics_path.read_text(encoding="utf-8"))["best"]
    else:
        _write_metrics(None)
        best_public = None
    start_time = time.time()

    print(f"\n[*] Starting training loop for epochs {start_epoch}-{num_epochs}. lr={LEARNING_RATE} gamma={FOCAL_GAMMA}")
    for epoch in range(start_epoch, num_epochs + 1):
        ep_start = time.time()
        tr_loss, tr_iou, tr_dice = train_one_epoch(model, train_loader, optimizer, criterion, scaler, device)
        val = validate(model, val_loader, criterion, device)
        look_fp = lookalike_fp_rate(model, val_files, device)
        scheduler.step(val["boundary_soft_recall"])

        ep_duration = time.time() - ep_start
        look_s = ""
        if look_fp is not None:
            look_s = f", look@0.5={look_fp['at_0.5']:.4f}, look@0.15={look_fp['at_0.15']:.4f}"
        print(
            f"Epoch [{epoch:02d}/{num_epochs:02d}] ({ep_duration:.1f}s) | "
            f"Train Loss: {tr_loss:.4f}, Dice: {tr_dice:.3f} | "
            f"boundary={val['boundary_soft_recall']:.4f} softP={val['soft_precision']:.4f} "
            f"softT={val['soft_tversky']:.4f} dice@0.5={val['global_dice']:.4f} "
            f"rec@0.5={val['recall']:.3f}{look_s}",
            flush=True,
        )
        log_row = {"epoch": epoch, "seconds": round(ep_duration, 1), "train_loss": tr_loss, **_public(val), "look": look_fp}
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(log_row) + "\n")

        if _beats_baseline(val, baseline) and val["boundary_soft_recall"] > best_boundary:
            best_boundary = float(val["boundary_soft_recall"])
            improved = True
            best_public = {
                "epoch": epoch,
                "boundary_soft_recall": val["boundary_soft_recall"],
                "soft_precision": val["soft_precision"],
                "soft_tversky": val["soft_tversky"],
                "soft_recall": val["soft_recall"],
                "global_dice": val["global_dice"],
                "recall_at_0.5": val["recall"],
                "precision_at_0.5": val["precision"],
                "lookalike_fp": look_fp,
            }
            torch.save(
                {
                    "epoch": epoch,
                    "model_state_dict": model.state_dict(),
                    "optimizer_state_dict": optimizer.state_dict(),
                    "val_dice": val["global_dice"],
                    "val_recall": val["recall"],
                    "val_precision": val["precision"],
                    "boundary_soft_recall": val["boundary_soft_recall"],
                    "soft_precision": val["soft_precision"],
                    "focal_gamma": FOCAL_GAMMA,
                    "init": INIT_NAME,
                    "manifest_hash": MANIFEST_HASH,
                    "pol": "index1_VV_dimap",
                    "scene_split": True,
                },
                best_model_path,
            )
            _write_metrics(best_public)
            print(
                f"  --> saved {best_model_path.name} boundary {val['boundary_soft_recall']:.4f} "
                f"(baseline {baseline['boundary_soft_recall']:.4f})",
                flush=True,
            )

    total_time_min = (time.time() - start_time) / 60
    _write_metrics(best_public)
    print("\n" + "=" * 65)
    print(f"Training Complete in {total_time_min:.1f} minutes!")
    print(f"Baseline boundary soft recall: {baseline['boundary_soft_recall']:.4f}")
    print(f"Best boundary soft recall: {best_boundary:.4f} improved={improved}")
    if improved:
        print(f"Candidate weights: {best_model_path}")
    else:
        print("No epoch beat the epoch-15 baseline. Live oil_unet.pt was not touched.")
    print("=" * 65)


if __name__ == "__main__":
    main()
