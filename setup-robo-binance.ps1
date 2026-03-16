# ⚡ Script para preparar ambiente Robo-Binance

# --- 1️⃣ Instalar Rust se não existir ---
if (-not (Get-Command rustc -ErrorAction SilentlyContinue)) {
    Write-Host "Rust não encontrado. Instalando via rustup..."
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile "$env:TEMP\rustup-init.exe"
    Start-Process "$env:TEMP\rustup-init.exe" -ArgumentList "-y" -Wait
    Remove-Item "$env:TEMP\rustup-init.exe"
    $env:Path += ";$env:USERPROFILE\.cargo\bin"
} else {
    Write-Host "Rust já instalado:" (rustc --version)
}

# --- 2️⃣ Instalar Visual Studio Build Tools com MSVC ---
if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    Write-Host "MSVC / Build Tools não encontrados. Instalando..."
    winget install --id Microsoft.VisualStudio.2022.BuildTools -e --silent
} else {
    Write-Host "MSVC Build Tools já instalado."
}

# --- 3️⃣ Instalar dependências Node ---
Write-Host "Instalando dependências Node na raiz..."
npm install

# Frontend
Write-Host "Instalando dependências do frontend..."
cd .\frontend_next
npm install

# Desktop
Write-Host "Instalando dependências do desktop..."
cd ..\desktop_app
npm install

# --- 4️⃣ Corrigir tauri.conf.json (Tauri 2.0) ---
$tauriConfigPath = ".\src-tauri\tauri.conf.json"
if (Test-Path $tauriConfigPath) {
    Write-Host "Atualizando tauri.conf.json para Tauri 2.0..."
    $tauriJson = @"
{
  "`$schema`": "https://schema.tauri.app/config/2",
  "productName": "Robo-Binance",
  "version": "0.1.0",
  "identifier": "com.robo.binance",
  "app": {
    "frontendDist": "../frontend_next/.next",
    "devUrl": "http://localhost:3000"
  },
  "bundle": {
    "active": true,
    "targets": ["msi", "nsis"]
  }
}
"@
    $tauriJson | Out-File -Encoding UTF8 $tauriConfigPath -Force
    Write-Host "tauri.conf.json atualizado."
} else {
    Write-Host "Aviso: tauri.conf.json não encontrado em src-tauri."
}

# --- 5️⃣ Rodar Tauri em modo dev ---
Write-Host "Iniciando Tauri em modo desenvolvimento..."
npx tauri dev