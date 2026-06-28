// src/main.js — Electron main process

const { app, BrowserWindow, ipcMain, dialog, Menu, Tray } = require('electron');
const path = require('path');
const fs   = require('fs');
const { startServer, stopServer } = require('../server/server');
const { getLocalIPs }            = require('../server/network-utils');
const QRCode = require('qrcode');

let mainWindow;
let tray           = null;
let serverInstance = null;
let serverUrl      = null;

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  600,
    height: 750,
    minWidth:  500,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (serverInstance) stopServer(serverInstance).catch(console.error);
  });

  createMenu();
}

// ─── Application Menu ─────────────────────────────────────────────────────────

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Change Save Folder',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory'],
              title: 'Select folder to save uploaded files'
            });
            if (!result.canceled) {
              mainWindow.webContents.send('folder-changed', result.filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type:    'info',
              title:   'About Local Sharer',
              message: 'Local Sharer',
              detail:  'Version 1.0.0\nShare files between devices on the same network.\n\nScan the QR code with your phone to upload files.',
              buttons: ['OK']
            });
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── System Tray ─────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  if (!fs.existsSync(iconPath)) return; // skip if no icon

  tray = new Tray(iconPath);
  tray.setToolTip('Local Sharer');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show App', click: () => mainWindow.show() },
    { label: 'Quit',     click: () => app.quit()        }
  ]));
  tray.on('click', () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show());
}

// ─── QR Code Generator ───────────────────────────────────────────────────────

async function generateQRCodeDataURL(text) {
  try {
    return await QRCode.toDataURL(text, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'H'
    });
  } catch (error) {
    console.error('Failed to generate QR code:', error);
    return null;
  }
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

ipcMain.handle('start-server', async (event, savePath) => {
  try {
    if (serverInstance) {
      await stopServer(serverInstance);
      serverInstance = null;
      serverUrl      = null;
    }

    if (!fs.existsSync(savePath)) fs.mkdirSync(savePath, { recursive: true });

    serverInstance = await startServer(savePath);
    serverUrl      = serverInstance.url;

    const ips          = getLocalIPs();
    const qrCodeDataURL = await generateQRCodeDataURL(serverUrl);

    return { success: true, url: serverUrl, ips, qrCode: qrCodeDataURL };
  } catch (error) {
    console.error('Failed to start server:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-server', async () => {
  try {
    if (serverInstance) {
      await stopServer(serverInstance);
      serverInstance = null;
      serverUrl      = null;
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to stop server:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select folder to save uploaded files'
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('get-default-folder', () => {
  return path.join(app.getPath('desktop'), 'LocalSharer');
});

ipcMain.handle('open-folder', (event, folderPath) => {
  if (!fs.existsSync(folderPath)) return;
  const { exec } = require('child_process');
  const cmd =
    process.platform === 'win32'  ? `explorer "${folderPath}"` :
    process.platform === 'darwin' ? `open "${folderPath}"`     :
                                    `xdg-open "${folderPath}"`;
  exec(cmd);
});

ipcMain.handle('get-server-status', () => ({
  isRunning: serverInstance !== null,
  url:       serverUrl
}));

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async event => {
  event.preventDefault();
  try {
    if (serverInstance) {
      await stopServer(serverInstance);
      serverInstance = null;
    }
    app.exit(0);
  } catch (error) {
    console.error('Error stopping server on quit:', error);
    app.exit(1);
  }
});
