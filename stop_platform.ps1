# QuantSaaS Platform Shutdown Script

Write-Host "Shutting down QuantSaaS Platform..." -ForegroundColor Red

# 1. Stop Frontend (Node.js)
Write-Host "Stopping Frontend..." -ForegroundColor Cyan
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*frontend_next*" } | Stop-Process -Force

# 2. Stop Trading Engine (Python)
Write-Host "Stopping Trading Engine..." -ForegroundColor Cyan
Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*engine.py*" } | Stop-Process -Force

# 3. Stop Backend API (Python)
Write-Host "Stopping Backend API..." -ForegroundColor Green
Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*main:app*" -or $_.CommandLine -like "*uvicorn*" } | Stop-Process -Force

# 4. Stop Infrastructure (Docker)
Write-Host "Stopping Docker Containers..." -ForegroundColor Blue
docker-compose down

Write-Host "All services stopped successfully." -ForegroundColor Green
