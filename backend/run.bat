@echo off
setlocal EnableExtensions
cd /d "%~dp0\.."

set "PY=python"
where python >nul 2>&1
if errorlevel 1 (
  where py >nul 2>&1
  if errorlevel 1 (
    echo Python not found on PATH. Install Python 3.11+ and tick "Add python.exe to PATH".
    pause
    exit /b 1
  )
  set "PY=py -3"
)

if exist "backend\requirements.txt" (
  %PY% -c "import fastapi,uvicorn" 1>nul 2>nul
  if errorlevel 1 (
    echo Installing Python packages...
    %PY% -m pip install -r backend\requirements.txt
    if errorlevel 1 (
      echo pip install failed.
      pause
      exit /b 1
    )
  )
)

echo.
echo API     http://127.0.0.1:8000
echo Health  http://127.0.0.1:8000/api/health
echo Leave this window open.
echo.

%PY% -m uvicorn main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
if errorlevel 1 (
  echo uvicorn failed. See SIH.md.
  pause
  exit /b 1
)
