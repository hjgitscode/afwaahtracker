@echo off
REM One click: Docker Desktop -> Oracle container -> API (3000) + web app (5173).
REM Double-click this file. Close the window (or press Ctrl+C) to stop the site.
REM If your Oracle container has another name: set ORACLE_CONTAINER=name before running.
setlocal EnableDelayedExpansion
cd /d "%~dp0"
if "%ORACLE_CONTAINER%"=="" set ORACLE_CONTAINER=afwaah-oracle

if not exist node_modules call npm run install-all
if not exist server\.env copy server\.env.example server\.env >nul

REM 1. Docker Desktop
docker info >nul 2>&1
if errorlevel 1 (
  echo Starting Docker Desktop ...
  if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
)
:wait_docker
docker info >nul 2>&1
if errorlevel 1 (
  timeout /t 3 /nobreak >nul
  goto wait_docker
)

REM 2. Oracle container (also set to restart by itself whenever Docker starts)
docker update --restart unless-stopped %ORACLE_CONTAINER% >nul 2>&1
docker start %ORACLE_CONTAINER% >nul 2>&1
if errorlevel 1 (
  echo Could not start the container "%ORACLE_CONTAINER%". Run "docker ps -a" to see its name,
  echo then run:  set ORACLE_CONTAINER=thatname  and start this file again from the same window.
  pause
  exit /b 1
)
echo Waiting for Oracle to accept connections (first start after a reboot can take 1-3 minutes) ...
set TRIES=0
:wait_db
call npm run -s db:check >nul 2>&1
if errorlevel 1 (
  set /a TRIES+=1
  if !TRIES! GEQ 60 goto db_failed
  timeout /t 5 /nobreak >nul
  goto wait_db
)
echo Oracle is ready.

REM 3. Website: open the browser a few seconds after the dev servers start
start "" cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:5173"
npm run dev
exit /b 0

:db_failed
echo Oracle did not become reachable within 5 minutes. The last check said:
call npm run db:check
pause
exit /b 1
