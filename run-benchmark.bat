@echo off
title Binance Bot - Auto Benchmark
cd /d "%~dp0\backend"

echo ===========================================
echo    INICIANDO BENCHMARK AUTOMATICO
echo ===========================================
echo.

call npm run benchmark

echo.
echo ===========================================
echo    BENCHMARK CONCLUIDO
echo ===========================================
pause
