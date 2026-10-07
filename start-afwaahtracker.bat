@echo off
REM Installs dependencies on first run and starts API (3000) + web app (5173).
cd /d "%~dp0"
if not exist node_modules call npm run install-all
if not exist server\.env copy server\.env.example server\.env >nul
start "" http://localhost:5173
npm run dev
