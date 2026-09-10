@echo off
title U-Net Trainer - RTX 4060
cd /d "%~dp0\..\.."

echo ========================================================
echo   Training U-Net on Sentinel-1 SAR (SIH 26143)
echo   Device: NVIDIA RTX 4060 (AMP Enabled)
echo ========================================================

python backend\ml\train.py

echo.
echo Training complete! Check backend\models\oil_unet.pt
pause
