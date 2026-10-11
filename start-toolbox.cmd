@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.19 or newer is required.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci --ignore-scripts
  if errorlevel 1 exit /b 1
)
call npm run build
if errorlevel 1 (
  pause
  exit /b 1
)
start "" /min powershell.exe -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 30;$i++){try{Invoke-RestMethod http://127.0.0.1:4317/api/health -TimeoutSec 1 | Out-Null; Start-Process http://127.0.0.1:4317; break}catch{Start-Sleep -Seconds 1}}"
call npm start
