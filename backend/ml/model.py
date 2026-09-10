"""U-Net Model Architecture & Combined Loss for SAR Oil Spill Detection."""

import torch
import torch.nn as nn
import torch.nn.functional as F

from config import ENCODER, ENCODER_WEIGHTS, IN_CHANNELS, CLASSES


class StandaloneUNet(nn.Module):
    """Pure PyTorch fallback U-Net (in case pretrained library weights are unavailable)."""
    def __init__(self, in_channels=1, out_channels=1):
        super().__init__()

        def conv_block(in_c, out_c):
            return nn.Sequential(
                nn.Conv2d(in_c, out_c, 3, padding=1),
                nn.BatchNorm2d(out_c),
                nn.ReLU(inplace=True),
                nn.Conv2d(out_c, out_c, 3, padding=1),
                nn.BatchNorm2d(out_c),
                nn.ReLU(inplace=True),
            )

        self.enc1 = conv_block(in_channels, 32)
        self.enc2 = conv_block(32, 64)
        self.enc3 = conv_block(64, 128)
        self.enc4 = conv_block(128, 256)

        self.pool = nn.MaxPool2d(2)

        self.bottleneck = conv_block(256, 512)

        self.up4 = nn.ConvTranspose2d(512, 256, 2, stride=2)
        self.dec4 = conv_block(512, 256)
        self.up3 = nn.ConvTranspose2d(256, 128, 2, stride=2)
        self.dec3 = conv_block(256, 128)
        self.up2 = nn.ConvTranspose2d(128, 64, 2, stride=2)
        self.dec2 = conv_block(128, 64)
        self.up1 = nn.ConvTranspose2d(64, 32, 2, stride=2)
        self.dec1 = conv_block(64, 32)

        self.out_conv = nn.Conv2d(32, out_channels, 1)

    def forward(self, x):
        e1 = self.enc1(x)
        e2 = self.enc2(self.pool(e1))
        e3 = self.enc3(self.pool(e2))
        e4 = self.enc4(self.pool(e3))

        b = self.bottleneck(self.pool(e4))

        d4 = self.dec4(torch.cat([self.up4(b), e4], dim=1))
        d3 = self.dec3(torch.cat([self.up3(d4), e3], dim=1))
        d2 = self.dec2(torch.cat([self.up2(d3), e2], dim=1))
        d1 = self.dec1(torch.cat([self.up1(d2), e1], dim=1))

        return self.out_conv(d1)


def build_model(device: str = "cuda", pretrained: bool = True) -> nn.Module:
    """Build U-Net. Inference should pass pretrained=False (no ImageNet download)."""
    try:
        import segmentation_models_pytorch as smp
        weights = ENCODER_WEIGHTS if pretrained else None
        print(f"[*] Building SMP U-Net with backbone: {ENCODER} (weights={weights})")
        model = smp.Unet(
            encoder_name=ENCODER,
            encoder_weights=weights,
            in_channels=IN_CHANNELS,
            classes=CLASSES,
            activation=None,  # Returns raw logits
        )
    except Exception as e:
        print(f"[!] SMP not available or offline ({e}). Using StandaloneUNet.")
        model = StandaloneUNet(in_channels=IN_CHANNELS, out_channels=CLASSES)

    return model.to(device)


class CombinedDiceBCELoss(nn.Module):
    """Dice Loss + Binary Cross Entropy with Logits for imbalanced oil masks."""
    def __init__(self, dice_weight: float = 0.5, smooth: float = 1e-6):
        super().__init__()
        self.dice_weight = dice_weight
        self.bce_weight = 1.0 - dice_weight
        self.smooth = smooth
        self.bce = nn.BCEWithLogitsLoss()

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        bce_loss = self.bce(logits, targets)

        probs = torch.sigmoid(logits)
        probs_flat = probs.view(-1)
        targets_flat = targets.view(-1)

        intersection = (probs_flat * targets_flat).sum()
        dice_loss = 1.0 - ((2.0 * intersection + self.smooth) / (probs_flat.sum() + targets_flat.sum() + self.smooth))

        return self.bce_weight * bce_loss + self.dice_weight * dice_loss


def calculate_metrics(logits: torch.Tensor, targets: torch.Tensor, threshold: float = 0.5, smooth: float = 1e-6):
    """Compute IoU and Dice (F1) scores for monitoring."""
    probs = torch.sigmoid(logits)
    preds = (probs > threshold).float()

    preds_flat = preds.view(-1)
    targets_flat = targets.view(-1)

    intersection = (preds_flat * targets_flat).sum().item()
    total = preds_flat.sum().item() + targets_flat.sum().item()
    union = total - intersection

    iou = (intersection + smooth) / (union + smooth)
    dice = (2.0 * intersection + smooth) / (total + smooth)

    return iou, dice
