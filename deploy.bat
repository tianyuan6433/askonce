@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

:: ============================================================
::  AskOnce Deploy Script for Windows
::  Prerequisites: Python 3.10+, Node.js 18+
::  Usage: deploy.bat [start|stop|restart|status|build|logs]
:: ============================================================

set "PROJECT_DIR=%~dp0"
set "BACKEND_DIR=%PROJECT_DIR%backend"
set "FRONTEND_DIR=%PROJECT_DIR%frontend"
set "PID_DIR=%PROJECT_DIR%.pids"
set "LOG_DIR=%PROJECT_DIR%.logs"

if not exist "%PID_DIR%" mkdir "%PID_DIR%"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

set "CMD=%~1"
if "%CMD%"=="" set "CMD=start"

if /i "%CMD%"=="start"   goto cmd_start
if /i "%CMD%"=="stop"    goto cmd_stop
if /i "%CMD%"=="restart" goto cmd_restart
if /i "%CMD%"=="status"  goto cmd_status
if /i "%CMD%"=="build"   goto cmd_build
if /i "%CMD%"=="logs"    goto cmd_logs

echo Usage: %~nx0 {start^|stop^|restart^|status^|build^|logs}
exit /b 1

:: ============================================================
::  Preflight checks
:: ============================================================
:preflight
echo [i] Running preflight checks...

:: Python
set "PYTHON="
where python >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=*" %%v in ('python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2^>nul') do set "PY_VER=%%v"
    for /f "tokens=1,2 delims=." %%a in ("!PY_VER!") do (
        if %%a GEQ 3 if %%b GEQ 10 set "PYTHON=python"
    )
)
if "!PYTHON!"=="" (
    where python3 >nul 2>&1
    if !errorlevel!==0 set "PYTHON=python3"
)
if "!PYTHON!"=="" (
    echo [x] Python 3.10+ is required. Please install from https://www.python.org/downloads/
    exit /b 1
)
for /f "tokens=*" %%v in ('!PYTHON! --version 2^>^&1') do echo [v] %%v

:: Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [x] Node.js is required. Please install from https://nodejs.org/
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo [v] Node.js %%v

:: npm
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [x] npm is required.
    exit /b 1
)

:: Backend .env
if not exist "%BACKEND_DIR%\.env" (
    if exist "%BACKEND_DIR%\.env.example" (
        copy "%BACKEND_DIR%\.env.example" "%BACKEND_DIR%\.env" >nul
        echo [!] Created backend\.env from template.
        echo [!] Please edit backend\.env with your API keys, then re-run.
        exit /b 1
    ) else (
        echo [x] backend\.env not found.
        exit /b 1
    )
)
echo [v] Backend config: backend\.env

findstr /r "ASKONCE_CLAUDE_API_KEY=.\+" "%BACKEND_DIR%\.env" >nul 2>&1
if %errorlevel% neq 0 (
    echo [x] ASKONCE_CLAUDE_API_KEY not set in backend\.env
    exit /b 1
)
echo [v] API key configured
exit /b 0

:: ============================================================
::  Build
:: ============================================================
:cmd_build
call :preflight
if %errorlevel% neq 0 exit /b 1

echo [i] Setting up Python virtual environment...
if not exist "%BACKEND_DIR%\venv" (
    !PYTHON! -m venv "%BACKEND_DIR%\venv"
)
call "%BACKEND_DIR%\venv\Scripts\activate.bat"
pip install -q --upgrade pip
pip install -q -r "%BACKEND_DIR%\requirements.txt"
call deactivate
echo [v] Backend dependencies installed

echo [i] Installing frontend dependencies...
cd /d "%FRONTEND_DIR%"
call npm ci --silent 2>nul || call npm install --silent
echo [v] Frontend dependencies installed

echo [i] Building frontend (production)...
call npm run build
echo [v] Frontend build complete
goto :eof

:: ============================================================
::  Start
:: ============================================================
:cmd_start
:: Build if needed
if not exist "%BACKEND_DIR%\venv" goto need_build
if not exist "%FRONTEND_DIR%\.next" goto need_build
goto skip_build

:need_build
call :cmd_build
if %errorlevel% neq 0 exit /b 1

:skip_build
call :preflight
if %errorlevel% neq 0 exit /b 1

:: Start backend
echo [i] Starting backend (FastAPI on port 8000)...
cd /d "%BACKEND_DIR%"
start /b "" "%BACKEND_DIR%\venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 > "%LOG_DIR%\backend.log" 2>&1

:: Wait and find backend PID
timeout /t 3 /nobreak >nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":8000 "') do (
    echo %%p> "%PID_DIR%\backend.pid"
    echo [v] Backend started ^(PID %%p^)
    goto backend_started
)
echo [x] Backend failed to start. Check: %LOG_DIR%\backend.log
type "%LOG_DIR%\backend.log"
exit /b 1

:backend_started

:: Start frontend
echo [i] Starting frontend (Next.js on port 3000)...
cd /d "%FRONTEND_DIR%"
start /b "" cmd /c "npx next start --port 3000 > "%LOG_DIR%\frontend.log" 2>&1"

:: Wait and find frontend PID
timeout /t 5 /nobreak >nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":3000 "') do (
    echo %%p> "%PID_DIR%\frontend.pid"
    echo [v] Frontend started ^(PID %%p^)
    goto frontend_started
)
echo [x] Frontend failed to start. Check: %LOG_DIR%\frontend.log
type "%LOG_DIR%\frontend.log"
exit /b 1

:frontend_started

echo.
echo [v] AskOnce is running!
echo.

:: Get server IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4" ^| findstr /v "127.0.0.1"') do (
    set "SERVER_IP=%%a"
    set "SERVER_IP=!SERVER_IP: =!"
    goto show_urls
)
set "SERVER_IP=localhost"

:show_urls
echo   Local access:     http://localhost:3000
echo   Network access:   http://!SERVER_IP!:3000
echo   API docs:         http://!SERVER_IP!:8000/docs
echo.
echo   Logs:    deploy.bat logs
echo   Status:  deploy.bat status
echo   Stop:    deploy.bat stop
goto :eof

:: ============================================================
::  Stop
:: ============================================================
:cmd_stop
echo [i] Stopping AskOnce...

if exist "%PID_DIR%\frontend.pid" (
    set /p FPID=<"%PID_DIR%\frontend.pid"
    taskkill /PID !FPID! /T /F >nul 2>&1
    del "%PID_DIR%\frontend.pid" >nul 2>&1
    echo [v] Frontend stopped
)

if exist "%PID_DIR%\backend.pid" (
    set /p BPID=<"%PID_DIR%\backend.pid"
    taskkill /PID !BPID! /T /F >nul 2>&1
    del "%PID_DIR%\backend.pid" >nul 2>&1
    echo [v] Backend stopped
)

:: Fallback: kill by port if PID files missing
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":8000 " 2^>nul') do (
    taskkill /PID %%p /T /F >nul 2>&1
)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":3000 " 2^>nul') do (
    taskkill /PID %%p /T /F >nul 2>&1
)

echo [v] AskOnce stopped.
goto :eof

:: ============================================================
::  Restart
:: ============================================================
:cmd_restart
call :cmd_stop
timeout /t 2 /nobreak >nul
goto cmd_start

:: ============================================================
::  Status
:: ============================================================
:cmd_status
echo.
set "BACKEND_RUNNING=0"
set "FRONTEND_RUNNING=0"

if exist "%PID_DIR%\backend.pid" (
    set /p BPID=<"%PID_DIR%\backend.pid"
    tasklist /FI "PID eq !BPID!" 2>nul | findstr "!BPID!" >nul 2>&1
    if !errorlevel!==0 (
        echo [v] Backend:  running ^(PID !BPID!^) on port 8000
        set "BACKEND_RUNNING=1"
    )
)
if "!BACKEND_RUNNING!"=="0" echo [x] Backend:  not running

if exist "%PID_DIR%\frontend.pid" (
    set /p FPID=<"%PID_DIR%\frontend.pid"
    tasklist /FI "PID eq !FPID!" 2>nul | findstr "!FPID!" >nul 2>&1
    if !errorlevel!==0 (
        echo [v] Frontend: running ^(PID !FPID!^) on port 3000
        set "FRONTEND_RUNNING=1"
    )
)
if "!FRONTEND_RUNNING!"=="0" echo [x] Frontend: not running

echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4" ^| findstr /v "127.0.0.1"') do (
    set "SERVER_IP=%%a"
    set "SERVER_IP=!SERVER_IP: =!"
    goto show_status_url
)
set "SERVER_IP=localhost"
:show_status_url
echo   Access URL: http://!SERVER_IP!:3000
echo.
goto :eof

:: ============================================================
::  Logs
:: ============================================================
:cmd_logs
echo === Backend Log ===
if exist "%LOG_DIR%\backend.log" type "%LOG_DIR%\backend.log"
echo.
echo === Frontend Log ===
if exist "%LOG_DIR%\frontend.log" type "%LOG_DIR%\frontend.log"
goto :eof
