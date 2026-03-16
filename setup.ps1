# QuantSaaS Platform Setup Script for Windows

Write-Host "🚀 Starting QuantSaaS Installation..." -ForegroundColor Yellow

# 1. Check Docker
if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Docker is required but not installed." -ForegroundColor Red
    exit
}

# 2. Setup Infrastructure
Write-Host "📦 Spinning up database and redis..." -ForegroundColor Cyan
docker-compose up -d

# 3. Setup Backend
Write-Host "🐍 Setting up Python Backend..." -ForegroundColor Green
cd backend_fastapi
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..

# 4. Setup Frontend
Write-Host "🌐 Setting up Next.js Frontend..." -ForegroundColor Blue
cd frontend_next
npm install
cd ..

Write-Host "✅ Installation Complete!" -ForegroundColor Green
Write-Host "Backend: http://localhost:8000"
Write-Host "Frontend: http://localhost:3000"
