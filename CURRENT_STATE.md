# OceanTrace — current state (2026-09-22)

Single snapshot. If another `.md` disagrees, **this file wins for live config**. Part 3 numbers below are the files named in the table. `oil_unet_part3_test.json` is the dark-rim test of the live epoch-15 model (recall **68.4%**). The epoch-18 test (56.4%) is `oil_unet_part3_test_epoch18.json`.

## Ports

| Port | What | Demo? |
|---|---|---|
| **8000** | FastAPI | required |
| **5174** | Judge Map (vanilla Leaflet) | **yes — 3-minute script** |
| **5175** | `oceantrace_frontend` dashboard | PPT / extra; API truth + local particles |
| **5173** | Frozen FFT ocean | **no** |

Map **Run investigation** does **not** run the U-Net (`pipeline.detect=false`). Upload `POST /api/investigate` **does**.

## Live model

`oil_unet.pt` is again a byte copy of `oil_unet_backup_run2.pt` (epoch **15**). EfficientNet-B0 U-Net, 1 channel, 512 tiles, AMP, batch 8. RTX 4060 Laptop 8 GB / 16 GB RAM.

- TIFF **index 1 = Sigma0_VV_db**, already in dB. Do not apply another `10·log10`.
- Inference: Gaussian stitch, short axes padded, overlap 128, TTA on, hysteresis **off**. The U-Net core is threshold **0.45**, blobs under **450** px dropped, then the mask grows **16** px into pixels at least **25** gray levels darker than the local sea. On the **335** Part 1/2 calibration scenes that raised oil recall **90.7% → 93.5%** and pale-edge recall **70.3% → 81.3%**. One Part 3 test of this checker is done: oil recall **68.4%**, Dice **0.739**, oil precision **80.4%**, scenes **148/150**, lookalike **79/150**, clean **31/150**. File: `oil_unet_part3_test_darkrim.json`. Do not retune the rim and test again.
- Tile validation for these weights (`oil_unet_metrics_backup.json`, epoch 15): Dice **0.844**, recall **0.896**, precision **0.798**.
- **Dice 0.881 is retired** (leaky tile split). Do not quote it.

## What was trained on 2026-09-22

One fine-tune. Part 3 was not used for training, epoch choice, or the cutoff.

- Start: `oil_unet_backup_run2.pt` epoch 15. Not `oil_unet_part1.pt`. Not the 30-epoch file.
- Loss: Tversky α **0.7** / β **0.3**, weight **0.6**, focal gamma **0.0** (plain BCE on the second term). Learning rate **1e-4**.
- Split: `split_manifest.json` hash `40b2b45dd2e0`. **17,662** train tiles, **3,777** model-validation tiles, **335** calibration scenes held out. Tiles on disk remain **25,168** (16,287 oil / 6,691 look / 2,190 no-oil).
- An epoch was kept only when pale-edge soft recall rose and soft precision stayed within **0.03** of the epoch-0 value **0.809** (floor **0.779**). Tile Dice at 0.5 was logged and not used to save.
- Epoch 0 on those practice tiles: edge recall **0.746**, tile recall at 0.5 **0.922**, Dice **0.863**.
- Best saved epoch: **18**. Edge recall **0.796**, tile recall **0.942**, soft precision **0.782**, Dice at 0.5 **0.856**. File: `oil_unet_gamma0.pt`. Copy: `oil_unet_gamma0_epoch18.pt`. Metrics: `oil_unet_metrics_gamma0.json`.
- The process died during epoch 23. Epochs 19–22 were worse than 18 and had not been saved. Epochs 23–25 were run again from the epoch-18 weights. They did not beat it (edge recall **0.738**, **0.775**, **0.753**).
- A scale-augmentation bug was fixed: a shrunk tile used to reflect the image and zero-pad the mask, so reflected oil was taught as sea. `dataset.py` `fit_pair` now reflects both.
- `train.py` no longer auto-loads `oil_unet_part1.pt`. `resume` continues from `oil_unet_gamma0.pt` without resetting the epoch-0 baseline.

Gamma 0 was not the main lever. Focal gamma 2 up-weights hard pixels; it does not erase pale-edge gradients. The 30-epoch drop to 54.2% is still real. This run did not repeat that drop, and it also did not beat 67% on the test.

## Practice scenes (335), then the test

Calibration read only the manifest calibration list. Pooled precision counts false oil on oil, lookalike, and clean scenes. The **0.85** floor was missed by **both** models, so nothing was promoted on that rule. Files: `calibration_backup_run2_manifest.json`, `calibration_gamma0_manifest.json`. `selected` is null in both.

Most precise cutoff each model reached (single threshold, blob 450):

| Weights | Oil recall | Pale-edge recall | Pooled precision |
|---|---:|---:|---:|
| Old epoch 15 | 0.898 | 0.680 | **0.739** |
| Epoch 18 | **0.936** | **0.745** | 0.703 |

Epoch 18 was then copied to `oil_unet.pt` and tested **once** at threshold **0.45**, blob **450** (its most precise practice cutoff). After that result, `oil_unet.pt` was restored to epoch 15 and the live cutoff was put back to **0.35 / 450**.

## Part 3 — test only (450 scenes)

Do not train, calibrate, or sweep cutoffs on `data/zenodo/Images`. The epoch-18 look is spent. Do not run another Part 3 eval to chase this table.

| Run | Oil pixel recall | Scenes hit | Dice | Oil precision | Lookalike scenes | Clean scenes |
|---|---:|---:|---:|---:|---:|---:|
| Run 1 oil-only | 72.8% | 148/150 | 0.805 | 90.0% | 147/150 | 125/150 |
| Run 2 + negatives | 63.4% | 147/150 | 0.738 | 88.4% | 106/150 | 89/150 |
| Box stitch, epoch 15, thr 0.35, blob 450 | **67.9%** | **148/150** | **0.764** | **87.3%** | **91/150** | **41/150** |
| Gaussian stitch, epoch 15, same era | **67.0%** | **148/150** | **0.758** | **87.4%** | **83/150** | **35/150** |
| 30-epoch retrain, thr 0.15, blob 200 | **54.2%** | **148/150** | **0.662** | **85.0%** | **78/150** | **31/150** |
| **Epoch 18, thr 0.45, blob 450 (2026-09-22)** | **56.4%** | **149/150** | **0.687** | **87.9%** | **64/150** | **29/150** |
| **Epoch 15 + 16 px dark rim (2026-09-22)** | **68.4%** | **148/150** | **0.739** | **80.4%** | **79/150** | **31/150** |

Scene false alarm means any predicted oil pixel. Not a 2,500 px rule.

JSON files:

- `oil_unet_part3_test.json` and `oil_unet_part3_test_darkrim.json` — epoch 15 plus the 16 px dark rim. Recall **0.684**, Dice **0.739**, oil precision **0.804**.
- `oil_unet_part3_test_epoch18.json` — epoch 18 at threshold 0.45, recall **0.564**.
- `oil_unet_part3_test_30ep_54recall.json` — the older 54.2% run, kept so it is not lost.

Tile recall of **0.942** on epoch 18 is a practice-tile score. It is not the test.

## Files that are not the live model

| File | What it is |
|---|---|
| `oil_unet.pt` | Live. Epoch 15, same bytes as `oil_unet_backup_run2.pt`. |
| `oil_unet_backup_run2.pt` | Old test weights. Untouched. |
| `oil_unet_gamma0.pt` | Epoch 18 fine-tune. Part 3 recall 56.4% at 0.45 / 450. |
| `oil_unet_gamma0_epoch18.pt` | Copy of that file taken before the resume. |
| `oil_unet_new_30ep_54recall.pt` | The 30-epoch run. Part 3 recall 54.2%. |
| `oil_unet_part1.pt` | Earlier leaky run, epoch 9, Dice 0.881. Do not initialize from it. |
| `oil_unet_metrics.json` | Still the 30-epoch tile metrics, not the live checkpoint. |

## What this run rules out

- Another epoch on this loss will not fix the test. Epochs after 18 were worse on the edge score.
- Practice-tile recall near **0.94** does not survive Part 3.
- An unreachable **0.85** pooled-precision rule rejects both models. It cannot pick a winner on these 335 scenes.
- The pixels still missing on the test are the pale edge. The 2–98% per-scene stretch and the 350 oil scenes whose tiles never cover the outer 192 px were not changed.

## Honesty

`python backend/ml/honesty_check.py`. No fake LIVE, no operational NTRO. Part 3 is test-only. `eval_part3.py` takes no arguments.
