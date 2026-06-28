const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startServer: (savePath) => ipcRenderer.invoke('start-server', savePath),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getDefaultFolder: () => ipcRenderer.invoke('get-default-folder'),
  openFolder: (path) => ipcRenderer.invoke('open-folder', path),
  onUploadProgress: (callback) => ipcRenderer.on('upload-progress', (_event, value) => callback(value))
});
