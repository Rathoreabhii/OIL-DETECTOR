# OceanTrace (SIH 26143)

Laptop caps: 16 GB RAM, RTX 4060 8 GB VRAM. 512 tiles, AMP, batch ≤ 8.

## Honesty

- Part III is frozen test. Never train or calibrate on `data/zenodo/Images`.
- Run `python backend/ml/honesty_check.py` after ML/doc edits and before quoting metrics.
- Subagents: `honesty-verifier` (metrics / Part 3) and `work-watchdog` (ongoing UI + ranking honesty). Skill: `/honesty-check`.
- Judge UI is port **5174**. Port **5173** is the frozen FFT ocean. Map Run investigation does not detect SAR.
- Do not quote Dice 0.881 (leaky tile split). Part 3 historical: recall 67.9%, Dice 0.764, precision 87.3%.
- No fake LIVE, no operational NTRO, no 2500 px false-alarm redefinition.

## ML

- Polarization: TIFF index 1 = `Sigma0_VV_db` (already dB).
- Leeway `toward_deg`: **0 = north, 90 = east** (AIS heading). Upload GeoTIFF uses the same VV stretch as training.
- Live snapshot: `CURRENT_STATE.md`.
- Calibrate on Part 1/2 val full scenes: `python backend/ml/calibrate.py --dry-run` then `--run`.
- `eval_part3.py` accepts no CLI overrides. One frozen re-eval after a freeze, then stop.
