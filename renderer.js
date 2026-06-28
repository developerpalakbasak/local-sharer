const savePathEl = document.getElementById('save-path');
const changeFolderBtn = document.getElementById('change-folder-btn');
const openFolderBtn = document.getElementById('open-folder-btn');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusPanel = document.getElementById('status-panel');
const statusText = document.getElementById('status-text');
const qrContainer = document.getElementById('qr-container');
const qrList = document.getElementById('qr-list');
const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadFilename = document.getElementById('upload-filename');
const uploadProgressBar = document.getElementById('upload-progress-bar');

let currentSavePath = '';
let serverRunning = false;
let progressTimeout = null;

window.electronAPI.onUploadProgress((data) => {
  uploadProgressContainer.style.display = 'block';
  uploadFilename.textContent = `Receiving: ${data.filename} (${data.progress}%)`;
  uploadProgressBar.style.width = `${data.progress}%`;

  if (progressTimeout) clearTimeout(progressTimeout);
  if (data.progress >= 100) {
    progressTimeout = setTimeout(() => {
      uploadProgressContainer.style.display = 'none';
    }, 3000);
  }
});

async function init() {
  const savedPath = localStorage.getItem('fileShare_savePath_v2');
  if (savedPath) {
    currentSavePath = savedPath;
  } else {
    currentSavePath = await window.electronAPI.getDefaultFolder();
    localStorage.setItem('fileShare_savePath_v2', currentSavePath);
  }
  savePathEl.textContent = currentSavePath;
}

changeFolderBtn.addEventListener('click', async () => {
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    currentSavePath = folder;
    savePathEl.textContent = folder;
    localStorage.setItem('fileShare_savePath_v2', folder);
  }
});

openFolderBtn.addEventListener('click', () => {
  if (currentSavePath) {
    window.electronAPI.openFolder(currentSavePath);
  }
});

startBtn.addEventListener('click', async () => {
  if (!currentSavePath) {
    alert('Please select a save folder first.');
    return;
  }
  
  startBtn.textContent = 'Starting...';
  startBtn.disabled = true;

  const res = await window.electronAPI.startServer(currentSavePath);
  if (res.ok) {
    serverRunning = true;
    startBtn.style.display = 'none';
    stopBtn.style.display = 'block';
    statusPanel.classList.remove('offline');
    statusPanel.classList.add('online');
    statusText.textContent = 'Running';
    
    qrContainer.style.display = 'block';
    qrList.innerHTML = '';
    
    if (res.entries) {
      res.entries.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'qr-item';
        item.innerHTML = `
          <img src="${entry.qrDataUrl}" alt="QR">
          <p>${entry.name}</p>
          <a href="${entry.url}" target="_blank">${entry.url}</a>
        `;
        qrList.appendChild(item);
      });
    }
  } else {
    alert('Failed to start server: ' + res.error);
    startBtn.disabled = false;
  }
  startBtn.textContent = 'Start Sharing';
  startBtn.disabled = false;
});

stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  await window.electronAPI.stopServer();
  
  serverRunning = false;
  startBtn.style.display = 'block';
  stopBtn.style.display = 'none';
  statusPanel.classList.add('offline');
  statusPanel.classList.remove('online');
  statusText.textContent = 'Stopped';
  qrContainer.style.display = 'none';
  uploadProgressContainer.style.display = 'none';
  qrList.innerHTML = '';
  
  stopBtn.disabled = false;
});

init();