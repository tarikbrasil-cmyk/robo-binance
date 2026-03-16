# Caminho do projeto
$projectPath = "C:\Users\LENOVO\.gemini\antigravity\scratch\binance-futures-bot\desktop_app"
$tauriConfPath = Join-Path $projectPath "src-tauri\tauri.conf.json"

# Criar src-tauri se não existir
if (!(Test-Path "$projectPath\src-tauri")) {
    Write-Host "Criando pasta src-tauri..."
    New-Item -ItemType Directory -Path "$projectPath\src-tauri"
}

# Criar tauri.conf.json compatível com Tauri 1.x
$tauriJson = @"
{
  "\$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/v1/cli/schema.json",
  "package": {
    "productName": "Robo-Binance",
    "version": "0.1.0"
  },
  "tauri": {
    "bundle": {
      "identifier": "com.robo.binance",
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
    ],
    "build": {
      "beforeBuildCommand": "npm --prefix ../frontend_next run build",
      "beforeDevCommand": "npm --prefix ../frontend_next run dev",
      "distDir": "../frontend_next/.next",
      "devPath": "http://localhost:3000"
    }
  }
}
"@

# Escrever JSON no arquivo
$tauriJson | Out-File -Encoding UTF8 -FilePath $tauriConfPath -Force
Write-Host "tauri.conf.json criado com sucesso!"

# Entrar no diretório e rodar Tauri
Set-Location $projectPath
Write-Host "Iniciando npx tauri dev..."
npx tauri dev