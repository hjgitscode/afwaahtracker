@echo off
REM ---------------------------------------------------------------
REM  AfwaahTracker - one-step Oracle setup for Windows (SQL*Plus)
REM  Usage:  setup-database.bat [SYSTEM_PASSWORD] [SERVICE]
REM  Example: setup-database.bat MyOraclePwd FREEPDB1
REM ---------------------------------------------------------------
setlocal
set SYSPWD=%1
set SERVICE=%2
if "%SERVICE%"=="" set SERVICE=FREEPDB1
if "%SYSPWD%"=="" set /p SYSPWD=Enter the Oracle SYSTEM password: 

where sqlplus >nul 2>nul
if errorlevel 1 (
  echo SQL*Plus was not found on PATH. Use "npm run db:install" instead after creating the user.
  exit /b 1
)

cd /d "%~dp0database"
echo.
echo [1/2] Creating application user AFWAAH on localhost:1521/%SERVICE% ...
sqlplus -L -S system/%SYSPWD%@localhost:1521/%SERVICE% @00_create_user.sql
echo.
echo [2/2] Installing schema, PL/SQL, views and seed data ...
echo exit | sqlplus -L -S afwaah/afwaah@localhost:1521/%SERVICE% @install.sql
if errorlevel 1 (
  echo Installation failed. See the messages above.
  exit /b 1
)
echo.
echo Done. Next: copy server\.env.example to server\.env, then run "npm run dev".
endlocal
