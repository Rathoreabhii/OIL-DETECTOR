"""Configuration for SAR Oil Spill U-Net Training & Preprocessing."""

from pathlib import Path

# Base Paths
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data"
ZENODO_RAW_DIR = DATA_DIR / "zenodo"
PROCESSED_DIR = DATA_DIR / "processed_512"
MODELS_DIR = PROJECT_ROOT / "backend" / "models"

# Tiling & Shrink Settings
# 2048x2048x2 Zenodo Part I scenes (VV, VH) cut into 512x512 patches
TILE_SIZE = 512
OVERLAP = 64  # pixels overlap between adjacent tiles
MIN_OIL_PIXELS = 50  # min oil pixels in a tile to count as positive (lowered for thin slicks)
BACKGROUND_SAMPLE_RATIO = 0.15  # keep only 15% of empty water tiles to shrink dataset
# DIMAP on these TIFFs: band 0 = Sigma0_VH_db, band 1 = Sigma0_VV_db.
# Oil–sea contrast is on index 1. Zenodo prose "(VV, VH)" is not TIFF order.
SAR_POL_INDEX = 1  # high-contrast pol (DIMAP Sigma0_VV_db)

# Target maximum scenes to process for full Part 1 + Part 2 dataset
MAX_SCENES_TO_PROCESS = 1200  # All 1,200 Part 1 oil scenes (500 already tiled + 700 leftover)

# Laptop hard caps. Verifiers and train scripts must not exceed these.
HOST_RAM_GB = 16
HOST_VRAM_GB = 8  # RTX 4060 Laptop

# Model & Training Settings (optimized for RTX 4060 8GB)
ENCODER = "efficientnet-b0"  # Fits 8GB VRAM; do not swap to a larger encoder
ENCODER_WEIGHTS = "imagenet"
IN_CHANNELS = 1  # Single-pol 8-bit PNG (TIFF index 1). Grayscale upload stays 1-channel.
CLASSES = 1  # Binary: oil (1) vs background (0)

BATCH_SIZE = 8  # Safe for 8GB VRAM with 512x512 tiles, 1 channel, AMP
NUM_WORKERS = 0  # Windows: extra workers duplicate RAM; 16 GB laptop → 0
# Part 2 append-only caps (hard negatives, balanced with oil tiles)
PART2_LOOK_SCENES = 685  # All 685 Part 2 lookalike scenes (400 already tiled + 285 leftover)
PART2_NOIL_SCENES = 350  # 350 clean sea scenes (200 already tiled + 150 extra)
PART2_KEEP_LOOK = 0.50
PART2_KEEP_NOIL = 0.30
LEARNING_RATE = 1e-4
WEIGHT_DECAY = 1e-4
NUM_EPOCHS = 40
VAL_SPLIT = 0.20
SEED = 42

# Device setup
DEVICE = "cuda"  # fallback to 'cpu' if cuda unavailable
AMP_ENABLED = True  # Automatic Mixed Precision for 2x faster training on RTX 4060
