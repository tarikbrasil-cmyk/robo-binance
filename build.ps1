# QuantSaaS Platform Unified Build Script

Write-Host "==========================================" -ForegroundColor Yellow
Write-Host "📦 Starting QuantSaaS Windows Build Pipeline" -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Yellow

# 1. Frontend Build
Write-Host "`n🌐 [1/2] Building Next.js Frontend (Static Export)..." -ForegroundColor Cyan
Set-Location frontend_next
npm install
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "❌ Frontend build failed!"; exit }
Set-Location ..

# 2. Tauri Desktop Build
Write-Host "`n🖥️ [2/2] Building Tauri Desktop Application (.exe)..." -ForegroundColor Magenta
Set-Location desktop_app
npm install
npx tauri build
if ($LASTEXITCODE -ne 0) { Write-Host "❌ Tauri build failed!"; exit }
Set-Location ..

Write-Host "`n==========================================" -ForegroundColor Green
Write-Host "✅ Build Complete!" -ForegroundColor Green
Write-Host "Artifacts location: desktop_app\src-tauri\target\release\bundle\msi\" -ForegroundColor Cyan
Write-Host "Portable EXE: desktop_app\src-tauri\target\release\Robo-Binance.exe" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Green
