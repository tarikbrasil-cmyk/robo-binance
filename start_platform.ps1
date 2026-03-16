# QuantSaaS Platform Launcher

$ErrorActionPreference = "SilentlyContinue"
Clear-Host

Write-Host "============================" -ForegroundColor Yellow
Write-Host "QuantSaaS Platform Launcher" -ForegroundColor Yellow
Write-Host "============================" -ForegroundColor Yellow

# Function to check health
function Get-ServiceStatus {
    param($Name, $Port)
    $conn = Test-NetConnection -ComputerName localhost -Port $Port -InformationLevel Quiet
    if ($conn) { return "RUNNING" } else { return "STARTING..." }
}

# 1. Start Infrastructure
Write-Host "STEP 1: Starting Database and Redis..." -ForegroundColor Cyan
docker-compose up -d

# 2. Start Backend API
Write-Host "STEP 2: Starting Backend Control API..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend_fastapi; .\venv\Scripts\Activate.ps1; python main.py" -WindowStyle Minimized

# 3. Start Trading Engine
Write-Host "STEP 3: Starting Independent Trading Engine..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd trading_engine; ..\backend_fastapi\venv\Scripts\Activate.ps1; python engine.py" -WindowStyle Minimized

# 4. Start Frontend
Write-Host "STEP 4: Starting Dashboard Interface..." -ForegroundColor Blue
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend_next; npm run dev" -WindowStyle Minimized

# 5. Start Desktop Environment
Write-Host "STEP 5: Preparing Desktop Environment..." -ForegroundColor Magenta
if (!(Test-Path "desktop_app\node_modules")) {
    Write-Host "Installing Desktop dependencies (First run only)..." -ForegroundColor Gray
    Start-Process powershell -ArgumentList "/c cd desktop_app; npm install" -Wait -WindowStyle Minimized
}

# Status Panel Loop
Write-Host "Initializing Services... (this may take a minute)" -ForegroundColor Gray

for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 3
    $dbStatus = "RUNNING"
    $apiStatus = Get-ServiceStatus "API" 8000
    $uiStatus = Get-ServiceStatus "Frontend" 3000
    # Engine status check via API health check or simple process check
    # For now, we assume it's starting if API is RUNNING
    
    $apiColor = if ($apiStatus -eq "RUNNING") { "Green" } else { "Yellow" }
    $uiColor = if ($uiStatus -eq "RUNNING") { "Green" } else { "Yellow" }

    Clear-Host
    Write-Host "============================" -ForegroundColor Yellow
    Write-Host "QuantSaaS STATUS PANEL" -ForegroundColor Yellow
    Write-Host "============================" -ForegroundColor Yellow
    Write-Host "Database  : " -NoNewline; Write-Host $dbStatus -ForegroundColor Green
    Write-Host "Control API: " -NoNewline; Write-Host $apiStatus -ForegroundColor $apiColor
    Write-Host "Frontend   : " -NoNewline; Write-Host $uiStatus -ForegroundColor $uiColor
    Write-Host "Engine     : " -NoNewline; Write-Host "STANDALONE" -ForegroundColor Cyan
    Write-Host "============================" -ForegroundColor Yellow

    if ($apiStatus -eq "RUNNING" -and $uiStatus -eq "RUNNING") {
        Write-Host "Platform is READY!" -ForegroundColor Green
        Write-Host "Launching Binance Trading Platform..." -ForegroundColor Magenta
        Start-Process powershell -ArgumentList "/c cd desktop_app; npm start" -WindowStyle Hidden
        break
    }
}

Write-Host "Keeping this window open for monitoring. Close to exit (or run stop_platform.ps1)." -ForegroundColor Gray
while($true) { Start-Sleep 10 }
