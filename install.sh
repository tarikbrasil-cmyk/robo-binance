#!/bin/bash
# QuantSaaS Platform Installation Script

echo "🚀 Starting QuantSaaS Installation..."

# 1. Check dependencies
command -v docker >/dev/null 2>&1 || { echo >&2 "❌ Docker is required but not installed. Aborting."; exit 1; }
command -v docker-compose >/dev/null 2>&1 || { echo >&2 "❌ docker-compose is required but not installed. Aborting."; exit 1; }

# 2. Setup Infrastructure
echo "📦 Spinning up database and redis..."
docker-compose up -d

# 3. Setup Backend
echo "🐍 Setting up Python Backend..."
cd backend_fastapi
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..

# 4. Setup Frontend
echo "🌐 Setting up Next.js Frontend..."
cd frontend_next
npm install
cd ..

echo "✅ Installation Complete!"
echo "To start the platform:"
echo "1. Backend: cd backend_fastapi && uvicorn main:app --reload"
echo "2. Frontend: cd frontend_next && npm run dev"
