# ============================================
# Setup e Dev Tauri 1.x para Robo-Binance
# ============================================

# Caminhos
$projectPath = "C:\Users\LENOVO\.gemini\antigravity\scratch\binance-futures-bot\desktop_app"
$tauriConfPath = Join-Path $projectPath "src-tauri\tauri.conf.json"
$vcVarsPath = "C:\Program Files\Microsoft Visual Studio\18\Insiders\VC\Auxiliary\Build\vcvars64.bat"

Write-Host "=== Iniciando setup do Tauri 1.x ==="

# 1️⃣ Criar pasta src-tauri se não existir
if (!(Test-Path "$projectPath\src-tauri")) {
    Write-Host "Criando pasta src-tauri..."
    New-Item -ItemType Directory -Path "$projectPath\src-tauri" | Out-Null
}

# 2️⃣ Criar tauri.conf.json limpo no formato 1.x
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

# Salvar como UTF-8 sem BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tauriConfPath, $tauriJson, $utf8NoBom)
Write-Host "tauri.conf.json criado com sucesso!"

# 3️⃣ Inicializar ambiente do Visual Studio Build Tools
Write-Host "Inicializando ambiente do VS Build Tools..."
cmd /c "`"$vcVarsPath`""

# 4️⃣ Entrar no diretório do projeto e rodar Tauri
Write-Host "Rodando npx tauri dev..."
cd $projectPath
npx tauri dev