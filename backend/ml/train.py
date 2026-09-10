import json
import sys
import time
from pathlib import Path
import torch
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
)
from dataset import get_dataloaders
from model import build_model, CombinedDiceBCELoss, calculate_metrics


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

        if AMP_ENABLED and device == "cuda":
            with torch.amp.autocast('cuda'):
                logits = model(images)
                loss = criterion(logits, masks)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
        else:
            logits = model(images)
            loss = criterion(logits, masks)
            loss.backward()
            optimizer.step()

        iou, dice = calculate_metrics(logits, masks)
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

    with torch.no_grad():
        for images, masks in loader:
            images = images.to(device, non_blocking=True)
            masks = masks.to(device, non_blocking=True)

            if AMP_ENABLED and device == "cuda":
                with torch.amp.autocast('cuda'):
                    logits = model(images)
                    loss = criterion(logits, masks)
            else:
                logits = model(images)
                loss = criterion(logits, masks)

            iou, dice = calculate_metrics(logits, masks)
            running_loss += loss.item()
            running_iou += iou
            running_dice += dice

            preds = (torch.sigmoid(logits.float()) > 0.5).float()
            tp += (preds * masks).sum().item()
            fp += (preds * (1.0 - masks)).sum().item()
            fn += ((1.0 - preds) * masks).sum().item()

    n = max(len(loader), 1)
    rec = tp / (tp + fn + 1e-9)
    prec = tp / (tp + fp + 1e-9)
    g_dice = (2.0 * tp) / (2.0 * tp + fp + fn + 1e-9)
    g_iou = tp / (tp + fp + fn + 1e-9)
    return {
        "loss": running_loss / n,
        "batch_iou": running_iou / n,
        "batch_dice": running_dice / n,
        "global_dice": g_dice,
        "global_iou": g_iou,
        "recall": rec,
        "precision": prec,
        "tp": int(tp),
        "fp": int(fp),
        "fn": int(fn),
    }


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

    # 1. Load Data
    train_loader, val_loader = get_dataloaders()

    # 2. Build Model
    model = build_model(device=device)
    criterion = CombinedDiceBCELoss(dice_weight=0.5)
    optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY)
    num_epochs = int(sys.argv[1]) if len(sys.argv) > 1 else NUM_EPOCHS
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="max", factor=0.5, patience=3)
    scaler = torch.amp.GradScaler('cuda', enabled=(AMP_ENABLED and device == "cuda"))

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    best_model_path = MODELS_DIR / "oil_unet.pt"

    best_val_dice = 0.0
    start_time = time.time()

    print(f"\n[*] Starting training loop for {num_epochs} epochs...")
    for epoch in range(1, num_epochs + 1):
        ep_start = time.time()
        tr_loss, tr_iou, tr_dice = train_one_epoch(model, train_loader, optimizer, criterion, scaler, device)
        val = validate(model, val_loader, criterion, device)
        scheduler.step(val["global_dice"])

        ep_duration = time.time() - ep_start
        print(
            f"Epoch [{epoch:02d}/{num_epochs:02d}] ({ep_duration:.1f}s) | "
            f"Train Loss: {tr_loss:.4f}, IoU: {tr_iou:.3f}, Dice: {tr_dice:.3f} | "
            f"Val Loss: {val['loss']:.4f}, batchDice: {val['batch_dice']:.3f}, "
            f"globalDice: {val['global_dice']:.3f}, rec: {val['recall']:.3f}, prec: {val['precision']:.3f}"
        )

        if val["global_dice"] > best_val_dice:
            best_val_dice = val["global_dice"]
            payload = {
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "val_dice": val["global_dice"],
                "val_iou": val["global_iou"],
                "val_recall": val["recall"],
                "val_precision": val["precision"],
                "pol": "index1_VV_dimap",
            }
            torch.save(payload, best_model_path)
            metrics_path = MODELS_DIR / "oil_unet_metrics.json"
            metrics_path.write_text(
                json.dumps({k: v for k, v in payload.items() if k not in ("model_state_dict", "optimizer_state_dict")}, indent=2),
                encoding="utf-8",
            )
            print(
                f"  --> [*] Best model saved! (global Dice {val['global_dice']:.4f}, "
                f"rec {val['recall']:.3f}, prec {val['precision']:.3f}) -> {best_model_path.name}"
            )

    total_time_min = (time.time() - start_time) / 60
    print("\n" + "=" * 65)
    print(f"Training Complete in {total_time_min:.1f} minutes!")
    print(f"Best Validation GLOBAL Dice: {best_val_dice:.4f}")
    print(f"Model saved to: {best_model_path}")
    print("=" * 65)


if __name__ == "__main__":
    main()
