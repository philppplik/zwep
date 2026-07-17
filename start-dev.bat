@echo off
SETLOCAL ENABLEEXTENSIONS
SET "ROOT=%~dp0"
SET "LOG=%ROOT%zwep-start.log"

echo ZWEP Starter started %DATE% %TIME% > "%LOG%"

echo.
echo   ZWEP  -  self-hosted search engine
echo.

REM step 1: find node via powershell (robust)
echo [1/6] Checking Node.js...
FOR /F "tokens=*" %%p IN ('powershell -NoProfile -Command "(Get-Command node -ErrorAction SilentlyContinue).Source"') DO SET "NODEEXE=%%p"
IF "%NODEEXE%"=="" (
  echo   Node.js not found. Install Node.js LTS from https://nodejs.org then re-run.
  echo   Log: %LOG%
  pause
  exit /b 1
)
echo   OK: node at %NODEEXE%
echo.

REM step 2: docker
echo [2/6] Checking Docker...
docker info >nul 2>&1
IF ERRORLEVEL 1 (
  echo   Docker not running. Start Docker Desktop, then re-run.
  echo   Log: %LOG%
  pause
  exit /b 1
)
echo   OK: docker running
echo.

REM step 3: db
echo [3/6] Starting database (Meili + Redis)...
docker compose up -d >> "%LOG%" 2>&1
echo   docker compose called
echo.

REM step 4: api
echo [4/6] Starting API on port 8080...
start "ZWEP-API" cmd /c "cd /d "%ROOT%" && "%NODEEXE%" --experimental-strip-types services/api/src/server.ts >> "%LOG%" 2>&1"
echo   API launching...
echo.

REM step 5: wait for api
echo [5/6] Waiting for API (up to 30s)...
SET /A TRIES=0
:WAIT
SET /A TRIES=%TRIES%+1
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri http://127.0.0.1:8080/healthz -UseBasicParsing -TimeoutSec 2).StatusCode } catch { 0 }" | findstr /r "200" >nul 2>nul
IF NOT ERRORLEVEL 1 GOTO READY
IF %TRIES% GEQ 30 (
  echo   API did not respond in 30s. See %LOG%
  GOTO AFTER
)
timeout /t 1 /nobreak >nul
GOTO WAIT
:READY
echo   OK: API ready at http://localhost:8080
echo.

REM step 6: web + browser
:AFTER
echo [6/6] Starting web UI on port 5173...
start "ZWEP-WEB" cmd /c "cd /d "%ROOT%web" && npm run dev >> "%LOG%" 2>&1"
echo   Web UI launching...
timeout /t 4 /nobreak >nul
start "" "http://localhost:5173"
echo.
echo   ============================================
echo    ZWEP IS RUNNING
echo    Search:        http://localhost:5173
echo    Admin/Sources: http://localhost:5173/admin
echo    Settings:      http://localhost:5173/settings
echo   Keep this window open. Press any key to stop.
echo   ============================================
echo.

pause >nul
echo Stopping...
taskkill /FI "WINDOWTITLE eq ZWEP-API*" >nul 2>&1
taskkill /FI "WINDOWTITLE eq ZWEP-WEB*" >nul 2>&1
echo Done. Close window.
exit /b 0
