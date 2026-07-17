@echo off
REM =====================================================================
REM  ZWEP - ONE-CLICK STARTER (beginner friendly)
REM  Just double-click. Starts DB + API + Web UI, opens the browser.
REM =====================================================================

SETLOCAL ENABLEEXTENSIONS
SET "ROOT=%~dp0"
SET "LOG=%ROOT%zwep-start.log"

echo =================================================================== > "%LOG%"
echo ZWEP Starter started: %DATE% %TIME% >> "%LOG%"

echo.
echo       .-..-.
echo      ( (  ) )
echo       '-''-'
echo      .-'`  `'-.
echo     /  ZWEP   \
echo    |  self-   |
echo     \ hosted  /
echo      '-.____.-'
echo.
echo   self-hosted search engine
echo.

REM --- 0) Find Node (fixed paths first, then PATH) ---
echo [...] Checking Node.js...
SET "NODEEXE="
if exist "C:\Program Files\nodejs\node.exe" SET "NODEEXE=C:\Program Files\nodejs\node.exe"
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" SET "NODEEXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if "%NODEEXE%"=="" (
  for /f "tokens=*" %%n in ('where node 2^>nul') do (
    if not "%%n"=="" if "%NODEEXE%"=="" SET "NODEEXE=%%n"
  )
)
if "%NODEEXE%"=="" (
  echo [!!] Node.js NOT found!
  echo       Install from https://nodejs.org (LTS), then run start-dev.bat again.
  echo.
  pause
  exit /b 1
)
REM make node available to child cmd windows
SET "PATH=%PATH%;%ROOT:~0,2%\Program Files\nodejs"
echo [OK] Node found.
echo.

REM --- 1) Check Docker (DB) ---
echo [...] Checking Docker...
where docker >nul 2>nul
if ERRORLEVEL 1 (
  echo [!!] Docker not found. Install Docker Desktop from https://docker.com
  echo       (or start Meili/Redis manually) and try again.
  echo.
  pause
  exit /b 1
)
docker info >nul 2>nul
if ERRORLEVEL 1 (
  echo [!!] Docker is not running. Please start Docker Desktop,
  echo       then run start-dev.bat again.
  echo.
  pause
  exit /b 1
)
echo [OK] Docker is running.
echo.

REM --- 2) Start Meili + Redis ---
echo [...] Starting database (Meili + Redis)...
docker compose up -d >> "%LOG%" 2>&1
echo [OK] docker compose called.
echo.

REM --- 3) Start API (background) ---
echo [...] Starting API (backend, port 8080)...
start "ZWEP-API" cmd /c "cd /d "%ROOT%" && "%NODEEXE%" --experimental-strip-types services/api/src/server.ts >> "%LOG%" 2>&1"
echo [OK] API starting...
echo.

REM --- 4) Wait for API ---
echo [...] Waiting for API...
set /a TRIES=0
:WAITAPI
set /a TRIES+=1
curl -s -o nul -w "%%{http_code}" http://127.0.0.1:8080/healthz 2>nul | findstr /r "^200$" >nul 2>nul
if NOT ERRORLEVEL 1 goto APIREADY
if %TRIES% GEQ 30 (
  echo [!!] API not responding after 30s. See %LOG%
  echo       (usually: port 8080 busy, or DB not ready)
  goto AFTERAPI
)
timeout /t 1 /nobreak >nul
goto WAITAPI
:APIREADY
echo [OK] API ready at http://localhost:8080
echo.

REM --- 5) Start Web UI (Vite) ---
:AFTERAPI
echo [...] Starting web interface (port 5173)...
start "ZWEP-WEB" cmd /c "cd /d "%ROOT%web" && npm run dev >> "%LOG%" 2>&1"
echo [OK] Web UI starting...
echo.

REM --- 6) Open browser ---
echo [...] Opening browser in 4s...
timeout /t 4 /nobreak >nul
start "" "http://localhost:5173"
echo.

echo   ============================================================
echo    ZWEP IS RUNNING
echo    - Search:        http://localhost:5173
echo    - Admin/Sources: http://localhost:5173/admin
echo    - Settings:      http://localhost:5173/settings
echo.
echo    Keep this window open. To stop: press any key.
echo   ============================================================
echo.

pause >nul
echo.
echo [...] Stopping Zwep...
taskkill /fi "WINDOWTITLE eq ZWEP-API*" >nul 2>nul
taskkill /fi "WINDOWTITLE eq ZWEP-WEB*" >nul 2>nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :8080 ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>nul
echo [OK] Stopped. You can close this window.
exit /b 0
