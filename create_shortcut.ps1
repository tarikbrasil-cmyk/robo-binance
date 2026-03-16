$desktopPath = [System.IO.Path]::Combine([System.Environment]::GetFolderPath('Desktop'), "Binance AI Bot.lnk")
$wshell = New-Object -ComObject WScript.Shell
$shortcut = $wshell.CreateShortcut($desktopPath)
$targetPath = "C:\Users\LENOVO\.gemini\antigravity\scratch\binance-futures-bot\start-bot.bat"
$shortcut.TargetPath = "cmd.exe"
$shortcut.Arguments = "/c `"$targetPath`""
$shortcut.WorkingDirectory = "C:\Users\LENOVO\.gemini\antigravity\scratch\binance-futures-bot"
$shortcut.Description = "Inicia o Robô Binance e Dashboard"
# Se houver um ícone (.ico), pode-se definir aqui:
# $shortcut.IconLocation = "path\to\icon.ico"
$shortcut.Save()

Write-Host "✅ Atalho 'Binance AI Bot' criado na Área de Trabalho!" -ForegroundColor Green
