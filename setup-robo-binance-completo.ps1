# ============================================
# Setup Total e Dev Tauri 1.x para Robo-Binance
# ============================================

# Caminhos
$projectPath = "C:\Users\LENOVO\.gemini\antigravity\scratch\binance-futures-bot\desktop_app"
$tauriConfPath = Join-Path $projectPath "src-tauri\tauri.conf.json"
$vcVarsPath = "C:\Program Files\Microsoft Visual Studio\18\Insiders\VC\Auxiliary\Build\vcvars64.bat"

# 0️⃣ Função para verificar executável
function Test-Command($cmd) {
    $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue)
}

Write-Host "=== Iniciando setup completo do Robo-Binance ==="

# 1️⃣ Node.js
if (-not (Test-Command "node")) {
    Write-Host "Node.js não encontrado! Instale manualmente em https://nodejs.org/"
    exit
} else {
    Write-Host "Node.js encontrado:" (node --version)
}

# 2️⃣ Rust
if (-not (Test-Command "rustc")) {
    Write-Host "Rust não encontrado! Instalando via rustup..."
    Invoke-WebRequest https://win.rustup.rs -OutFile "$env:TEMP\rustup-init.exe"
    & "$env:TEMP\rustup-init.exe" -y
} else {
    Write-Host "Rust encontrado:" (rustc --version)
}

# 3️⃣ MSVC Build Tools
if (-not (Test-Path $vcVarsPath)) {
    Write-Host "MSVC Build Tools não encontrado no caminho esperado!"
    Write-Host "Instale manualmente via https://visualstudio.microsoft.com/visual-cpp-build-tools/"
    exit
} else {
    Write-Host "MSVC Build Tools encontrado."
    cmd /c "`"$vcVarsPath`""
}

# 4️⃣ Criar pasta src-tauri se não existir
if (!(Test-Path "$projectPath\src-tauri")) {
    Write-Host "Criando pasta src-tauri..."
    New-Item -ItemType Directory -Path "$projectPath\src-tauri" | Out-Null
}

# 5️⃣ Criar tauri.conf.json no formato 1.x (UTF-8 sem BOM)
$tauriJson = @'
{
  "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/v1/cli/schema.json",
  "package": {
    "productName": "Robo-Binance",
    "version": "0.1.0",
    "identifier": "com.robo.binance"
  },
  "tauri": {
    "build": {
      "beforeBuildCommand": "npm --prefix ../frontend_next run build",
      "beforeDevCommand": "npm --prefix ../frontend_next run dev",
      "devPath": "http://localhost:3000",
      "distDir": "../frontend_next/.next"
    },
    "bundle": {
      "active": true,
      "targets": ["msi", "nsis"]
    },
    "windows": [
      {
        "title": "Robo Binance",
        "width": 1280,
        "height": 800,
        "resizable": true
      }
    ]
  }
}
'@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tauriConfPath, $tauriJson, $utf8NoBom)
Write-Host "tauri.conf.json criado com sucesso!"

# 6️⃣ Entrar no diretório do projeto
Set-Location $projectPath

# 7️⃣ Instalar Tauri 1.x
Write-Host "Instalando Tauri 1.x..."
npm uninstall @tauri-apps/cli @tauri-apps/api
npm install @tauri-apps/cli@1 @tauri-apps/api@1

# 8️⃣ Roda Tauri dev
Write-Host "Iniciando npx tauri dev..."
npx tauri dev