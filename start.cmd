@echo off
rem SMART-ER launcher.
rem
rem Double-click this file, or run it from any directory. It moves to its own
rem folder first, which is the whole point: npm has to run where package.json
rem is, and the usual failure is a shell sitting somewhere else entirely.

setlocal
cd /d "%~dp0"

echo.
echo   SMART-ER
echo   %CD%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   Node.js was not found on PATH.
  echo   Install Node 22.5 or newer from https://nodejs.org, then run this again.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do echo   Node %%v
echo.

if not exist "node_modules" (
  echo   Installing dependencies. The first run takes a few minutes.
  call npm install
  if errorlevel 1 goto failed
  echo.
)

echo   Building.
call npm run build
if errorlevel 1 goto failed
echo.

if not defined SIM_SCENARIO set "SIM_SCENARIO=multi-vehicle"

echo   -------------------------------------------------------------
echo     Open   http://localhost:4000
echo     Sign in as  controller@smart-er.example
echo     Stop with   Ctrl+C
echo   -------------------------------------------------------------
echo.

call npm start
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo   That step failed. The error is above this line.
echo.
pause
exit /b 1
