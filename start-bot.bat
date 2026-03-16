@echo off
setlocal
title Binance Quant Bot Launcher
cd /d "%~dp0"

echo ===========================================
echo    BINANCE QUANT BOT - SELECT MODE
echo ===========================================
echo [1] SPOT (Buy only, 1x leverage, Demo Spot)
echo [2] FUTURES (Long/Short, Leverage, Demo Futures)
echo [3] BACKTEST (Simulação 5s Histórico)
echo ===========================================
set /p choice="Escolha o modo (1, 2 ou 3): "

if "%choice%"=="3" (
    echo.
    echo Iniciando Backtesting Histórico...
    echo.
    cd backend && node backtest.js
    echo.
    echo Backtest finalizado. Pressione qualquer tecla para sair.
    pause >nul
    exit
)

if "%choice%"=="1" (
    set BOT_MODE=SPOT
    set TITLE_MODE=SPOT
) else (
    set BOT_MODE=FUTURES
    set TITLE_MODE=FUTURES
)

echo.
echo Iniciando em modo: %TITLE_MODE%...
echo.

echo [1/2] Iniciando o Servidor Backend...
start "Binance Bot - Backend %TITLE_MODE%" cmd /k "title Backend %TITLE_MODE% && cd backend && set BOT_MODE=%BOT_MODE% && npm run start"

echo.
echo [2/2] Iniciando o Dashboard Frontend...
start "Binance Bot - Dashboard UI" cmd /k "title Frontend && cd frontend && npm run dev"

echo.
echo Ambientes ativos.
echo Dashboard: http://localhost:5173
start http://localhost:5173
echo.
timeout /t 5 >nul
exit
