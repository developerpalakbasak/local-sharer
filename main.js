import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { startServer, stopServer, serverEvents } from './server.js';

serverEvents.on('uploadProgress', (data) => {
  if (win && !win.isDestroyed()) {
    win.webContents.send('upload-progress', data);
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let win;
let activeServer = null;
let tray = null;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 820,
    height: 700,
    minWidth: 640,
    minHeight: 540,
    frame: true,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets/icon.png'),
    backgroundColor: '#0b0e14',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
  });

  win.loadFile('index.html');
  
  win.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      win.hide();
    }
  });

  tray = new Tray(path.join(__dirname, 'assets/icon.png'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show App', click: () => { if (win) { win.show(); win.focus(); } } },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } }
  ]);
  tray.setToolTip('Local Sharer');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => { if (win) { win.show(); win.focus(); } });
});

ipcMain.handle('start-server', async (event, savePath) => {
  if (activeServer) {
    return { ok: true, already: true };
  }
  try {
    const result = await startServer(4000, savePath);
    activeServer = result;
    return { ok: true, entries: result.entries, port: result.port };
  } catch (err) {
    console.error('Server start failed:', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('stop-server', async () => {
  if (activeServer) {
    await stopServer(activeServer);
    activeServer = null;
  }
  return { ok: true };
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Select Destination Folder'
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('get-default-folder', () => {
  return path.join(app.getPath('desktop'), 'Local Sharer');
});

ipcMain.handle('open-folder', async (event, folderPath) => {
  if (folderPath) await shell.openPath(folderPath);
});

app.on('before-quit', async (e) => {
  if (activeServer) {
    e.preventDefault();
    await stopServer(activeServer);
    activeServer = null;
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
}
