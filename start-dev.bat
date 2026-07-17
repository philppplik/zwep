@echo off
REM =====================================================================
REM  ZWEP - EIN-KLICK-STARTER (fuer Laien)
REM  Doppelklick reicht. Startet Datenbank + API + Web-Oberflaeche
REM  und oeffnet den Browser automatisch.
REM =====================================================================

SETLOCAL ENABLEEXTENSIONS
SET "ROOT=%~dp0"
SET "LOG=%ROOT%zwep-start.log"

REM --- farbige Hilfstexte ---
SET "OK=[OK]"
SET "INFO=[..]"
SET "WARN=[!!]"

echo =================================================================== > "%LOG%"
echo ZWEP Starter gestartet: %DATE% %TIME% >> "%LOG%"

echo.
echo  ============================================================
echo   ZWEP — Self-hosted Search Engine
echo  ============================================================
echo.

REM --- 1) Node pruefen ---
echo %INFO% Pruefe Node.js...
where node >nul 2>nul
if ERRORLEVEL 1 (
  echo %WARN% Node.js ist NICHT installiert!
  echo         Bitte von https://nodejs.org installieren (LTS),
  echo         dann dieses Fenster schliessen und .bat erneut starten.
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo %OK% Node %%v gefunden
echo.

REM --- 2) Docker pruefen (Meili + Redis) ---
echo %INFO% Pruefe Docker (Datenbank)...
where docker >nul 2>nul
if ERRORLEVEL 1 (
  echo %WARN% Docker ist nicht installiert. Meili/Redis fehlen.
  echo         Installiere Docker Desktop von https://docker.com
  echo         (oder starte Meili/Redis manuell) und versuche erneut.
  echo.
  pause
  exit /b 1
)
docker info >nul 2>nul
if ERRORLEVEL 1 (
  echo %WARN% Docker laeuft nicht. Bitte Docker Desktop starten,
  echo         dann dieses Fenster schliessen und .bat erneut starten.
  echo.
  pause
  exit /b 1
)
echo %OK% Docker laeuft.
echo.

REM --- 3) Meili/Redis starten (falls noch nicht up) ---
echo %INFO% Starte Datenbank (Meili + Redis)...
docker compose up -d >> "%LOG%" 2>&1
if ERRORLEVEL 1 (
  echo %WARN% docker compose fehlgeschlagen — siehe %LOG%
  echo         (Meili/Redis evtl. schon oben, weitere Versuche...)
)
echo %OK% docker compose aufgerufen.
echo.

REM --- 4) API starten (Hintergrund) ---
echo %INFO% Starte API (Backend, Port 8080)...
start "ZWEP-API" cmd /c "cd /d "%ROOT%" && node --experimental-strip-types services/api/src/server.ts >> "%LOG%" 2>&1"
echo %OK% API wird gestartet...
echo.

REM --- 5) Warten bis API bereit ---
echo %INFO% Warte auf API...
set /a TRIES=0
:WAITAPI
set /a TRIES+=1
curl -s -o nul -w "%%{http_code}" http://127.0.0.1:8080/healthz 2>nul | findstr /r "^200$" >nul 2>nul
if NOT ERRORLEVEL 1 goto APIREADY
if %TRIES% GEQ 30 (
  echo %WARN% API antwortet nicht nach 30s. Siehe %LOG%
  echo         Meist: Port 8080 schon belegt oder DB nicht bereit.
  goto AFTERAPI
)
timeout /t 1 /nobreak >nul
goto WAITAPI
:APIREADY
echo %OK% API bereit auf http://localhost:8080
echo.

REM --- 6) Web-UI starten (Vite) ---
:AFTERAPI
echo %INFO% Starte Web-Oberflaeche (Port 5173)...
start "ZWEP-WEB" cmd /c "cd /d "%ROOT%web" && npm run dev >> "%LOG%" 2>&1"
echo %OK% Web-UI wird gestartet...
echo.

REM --- 7) Browser oeffnen ---
echo %INFO% Oeffne Browser in 4s...
timeout /t 4 /nobreak >nul
start "" "http://localhost:5173"
echo.

echo  ============================================================
echo   ZWEP LAEUFT
echo   - Suche:       http://localhost:5173
echo   - Admin/Quellen: http://localhost:5173/admin
echo   - Einstellungen: http://localhost:5173/settings
echo.
echo   Dieses Fenster NICHT schliessen (sonst laeuft Zwep weiter
echo   im Hintergrund, aber sauber beenden geht nur hier).
echo   Zum Beenden: Taste druecken -> beendet alles.
echo  ============================================================
echo.

pause >nul
echo.
echo %INFO% Beende Zwep...
taskkill /fi "WINDOWTITLE eq ZWEP-API*" >nul 2>nul
taskkill /fi "WINDOWTITLE eq ZWEP-WEB*" >nul 2>nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :8080 ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>nul
echo %OK% Gestoppt. Fenster kann geschlossen werden.
exit /b 0
