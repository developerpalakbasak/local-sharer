const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startServer: (savePath) => ipcRenderer.invoke('start-server', savePath),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getDefaultFolder: () => ipcRenderer.invoke('get-default-folder'),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),
  onFolderChanged: (callback) => ipcRenderer.on('folder-changed', (event, path) => callback(path)),
  onFileUploaded: (callback) => ipcRenderer.on('file-uploaded', (event, file) => callback(file))
});