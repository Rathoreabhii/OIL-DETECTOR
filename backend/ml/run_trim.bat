@echo off
title Low-RAM SAR Dataset Trimmer (32-bit to 8-bit, 512x512)
cd /d "%~dp0\..\.."

echo ========================================================
echo   SAR Oil Spill Dataset Trimmer ^& Tiler
echo   Memory-Safe Mode: Peak RAM ^< 300 MB
echo   Converting 32-bit float to 8-bit PNG
echo   Output Size: ~1 to 2 GB
echo ========================================================

python backend\ml\selective_trim.py

echo.
echo Process finished!
pause
