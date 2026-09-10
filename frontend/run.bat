@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found on PATH. Install Node.js LTS, then try again.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo frontend\package.json is missing. See SIH.md.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo First run: npm install ...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo Map UI  http://localhost:5174
echo Backend must already be running on port 8000.
echo Leave this window open.
echo.

call npm run dev -- --port 5174 --host
if errorlevel 1 (
  echo Vite failed. See SIH.md.
  pause
  exit /b 1
)
