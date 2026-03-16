const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0b0e11',
    title: "QuantSaaS | Binance Trading Platform",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    // Removendo a barra de menus padrão para um visual mais limpo
    autoHideMenuBar: true,
  });

  // Carrega o dashboard do Next.js (assumindo que o dev server está rodando na porta 3000)
  win.loadURL('http://localhost:3000/dashboard');

  // Abre links externos no navegador padrão do sistema
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('page-title-updated', (e) => {
    e.preventDefault();
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
