@echo off
REM Zwep dev launcher for Windows — double-click to run.
REM Starts the API (8080) + Vite web UI (5173).
REM NOTE: Meilisearch + Redis must already be running (docker compose up -d).
REM The Vite proxy forwards /v1/* to the API; if the API is down you get
REM ECONNREFUSED / 500 in the admin console.

cd /d "%~dp0"

echo → starting API on :8080
start "Zwep API" cmd /k "node --experimental-strip-types services/api/src/server.ts"

timeout /t 3 >nul

echo → starting Vite on :5173 (proxy to :8080)
cd web
start "Zwep Web" cmd /k "npm run dev"

echo.
echo Zwep dev running. Close the two opened terminal windows to stop.
pause
