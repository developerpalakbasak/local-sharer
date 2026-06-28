// src/preload.js — Context bridge for Electron renderer ↔ main process

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startServer:     (savePath)  => ipcRenderer.invoke('start-server',     savePath),
  stopServer:      ()          => ipcRenderer.invoke('stop-server'),
  selectFolder:    ()          => ipcRenderer.invoke('select-folder'),
  getDefaultFolder:()          => ipcRenderer.invoke('get-default-folder'),
  openFolder:      (folderPath)=> ipcRenderer.invoke('open-folder',      folderPath),
  getServerStatus: ()          => ipcRenderer.invoke('get-server-status'),
  onFolderChanged: (callback)  => ipcRenderer.on('folder-changed', (_event, p) => callback(p)),
  onFileUploaded:  (callback)  => ipcRenderer.on('file-uploaded',  (_event, f) => callback(f))
});
