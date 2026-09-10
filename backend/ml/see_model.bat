@echo off
title See U-Net in terminal
cd /d "%~dp0\..\.."
python backend\ml\see_model.py
echo.
pause
