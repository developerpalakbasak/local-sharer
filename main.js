// main.js

const { app, BrowserWindow, ipcMain, dialog, Menu, Tray } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer, stopServer } = require('./server');
const { getLocalIPs } = require('./network-utils');
const QRCode = require('qrcode'); // Add this import

let mainWindow;
let tray = null;
let serverInstance = null; // Changed from 'server' to 'serverInstance' for clarity
let serverUrl = null;

// Keep a global reference to prevent garbage collection
let serverProcess = null;

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 600,
    height: 750, // Increased height for better QR display
    minWidth: 500,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets/icon.png'),
    show: false // Don't show until ready-to-show
  });

  // Load the index.html
  mainWindow.loadFile('index.html');

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Stop server when window is closed
    if (serverInstance) {
      stopServer(serverInstance).catch(console.error);
    }
  });

  // Create application menu
  createMenu();
}

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
              type: 'info',
              title: 'About File Share',
              message: 'File Share App',
              detail: 'Version 1.0.0\nShare files between devices in the same network.\n\nScan QR code with your phone to upload files.',
              buttons: ['OK']
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets/icon.png'));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        mainWindow.show();
      }
    },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setToolTip('File Share App');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

// Generate QR Code as Data URL
async function generateQRCodeDataURL(text) {
  try {
    return await QRCode.toDataURL(text, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      },
      errorCorrectionLevel: 'H'
    });
  } catch (error) {
    console.error('Failed to generate QR code:', error);
    return null;
  }
}

// IPC Handlers
ipcMain.handle('start-server', async (event, savePath) => {
  try {
    // If server is already running, stop it first
    if (serverInstance) {
      await stopServer(serverInstance);
      serverInstance = null;
      serverUrl = null;
    }

    // Create save directory if it doesn't exist
    if (!fs.existsSync(savePath)) {
      fs.mkdirSync(savePath, { recursive: true });
    }

    // Start the server
    serverInstance = await startServer(savePath);
    serverUrl = serverInstance.url;

    // Get local IPs
    const ips = getLocalIPs();

    // Generate QR code
    const qrCodeDataURL = await generateQRCodeDataURL(serverUrl);

    return {
      success: true,
      url: serverInstance.url,
      ips: ips,
      qrCode: qrCodeDataURL
    };
  } catch (error) {
    console.error('Failed to start server:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('stop-server', async () => {
  try {
    if (serverInstance) {
      console.log('Stopping server...');
      await stopServer(serverInstance);
      serverInstance = null;
      serverUrl = null;
      console.log('Server stopped successfully');
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to stop server:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select folder to save uploaded files'
  });

  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('get-default-folder', () => {
  const loc = path.join(app.getPath('desktop'), 'FileShare');
  return loc
});

ipcMain.handle('open-folder', (event, folderPath) => {
  if (fs.existsSync(folderPath)) {
    require('child_process').exec(
      process.platform === 'win32'
        ? `explorer "${folderPath}"`
        : process.platform === 'darwin'
          ? `open "${folderPath}"`
          : `xdg-open "${folderPath}"`
    );
  }
});

ipcMain.handle('get-server-status', () => {
  return {
    isRunning: serverInstance !== null,
    url: serverUrl
  };
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  createTray();

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

app.on('before-quit', async (event) => {
  // Prevent the app from quitting immediately
  event.preventDefault();

  try {
    if (serverInstance) {
      console.log('Stopping server before quit...');
      await stopServer(serverInstance);
      serverInstance = null;
      console.log('Server stopped, quitting now...');
    }
    app.exit(0);
  } catch (error) {
    console.error('Error stopping server:', error);
    app.exit(1);
  }
});