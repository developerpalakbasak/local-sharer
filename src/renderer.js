// src/renderer.js — Electron window renderer logic

let currentSavePath = '';
let serverRunning   = false;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const savePathEl      = document.getElementById('savePath');
const statusIcon      = document.getElementById('statusIcon');
const statusTitle     = document.getElementById('statusTitle');
const statusMessage   = document.getElementById('statusMessage');
const qrSection       = document.getElementById('qrSection');
const qrCode          = document.getElementById('qrCode');
const serverUrlEl     = document.getElementById('serverUrl');
const ipList          = document.getElementById('ipList');
const startBtn        = document.getElementById('startBtn');
const stopBtn         = document.getElementById('stopBtn');
const changeFolderBtn = document.getElementById('changeFolderBtn');
const openFolderBtn   = document.getElementById('openFolderBtn');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const savedPath = localStorage.getItem('fileShare_savePath');

    if (savedPath && savedPath.trim()) {
      currentSavePath = savedPath;
    } else {
      currentSavePath = await window.electronAPI.getDefaultFolder();
      if (currentSavePath) localStorage.setItem('fileShare_savePath', currentSavePath);
    }

    savePathEl.textContent = currentSavePath || 'No folder selected';

    const status = await window.electronAPI.getServerStatus();
    if (status.isRunning) {
      serverRunning = true;
      updateUIForServerStart(status.url);
    }
  } catch (error) {
    console.error('Init error:', error);
    savePathEl.textContent = 'Please select a folder';
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function updateUIForServerStart(url) {
  serverRunning           = true;
  statusIcon.textContent  = '🟢';
  statusTitle.textContent = 'Server is running';
  statusMessage.textContent = 'Ready for connections';
  startBtn.disabled = true;
  stopBtn.disabled  = false;

  qrSection.style.display   = 'block';
  serverUrlEl.textContent   = url;

  if (openFolderBtn) openFolderBtn.disabled = false;
}

function updateUIForServerStop() {
  serverRunning             = false;
  statusIcon.textContent    = '⏸️';
  statusTitle.textContent   = 'Server is stopped';
  statusMessage.textContent = 'Click start to begin sharing';
  startBtn.disabled = false;
  stopBtn.disabled  = true;

  qrSection.style.display = 'none';
  qrCode.src = '';

  if (openFolderBtn) openFolderBtn.disabled = true;
}

function displayIPs(ips) {
  ipList.innerHTML = '';
  ips.forEach(ip => {
    const item = document.createElement('div');
    item.className   = 'ip-item';
    item.textContent = `${ip.interface}: ${ip.address}`;
    ipList.appendChild(item);
  });
}

function showToast(message) {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className   = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ─── Button handlers ──────────────────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
  if (!currentSavePath || currentSavePath.trim() === '' || currentSavePath === 'Please select a folder') {
    currentSavePath = await window.electronAPI.getDefaultFolder();
    savePathEl.textContent = currentSavePath;
    if (!currentSavePath) { showToast('Please select a save folder first'); return; }
  }

  startBtn.textContent = 'Starting…';
  startBtn.disabled    = true;

  const result = await window.electronAPI.startServer(currentSavePath);

  if (result.success) {
    updateUIForServerStart(result.url);
    displayIPs(result.ips);
    if (result.qrCode) qrCode.src = result.qrCode;
    showToast('Server started!');
  } else {
    showToast(`Failed: ${result.error}`);
    startBtn.innerHTML = '<span class="btn-icon">▶</span> Start Sharing';
    startBtn.disabled  = false;
  }
});

stopBtn.addEventListener('click', async () => {
  stopBtn.textContent = 'Stopping…';
  stopBtn.disabled    = true;

  const result = await window.electronAPI.stopServer();

  if (result.success) {
    updateUIForServerStop();
    showToast('Server stopped');
  } else {
    showToast(`Error: ${result.error}`);
    stopBtn.innerHTML = '<span class="btn-icon">⏹</span> Stop Sharing';
    stopBtn.disabled  = false;
  }
});

changeFolderBtn.addEventListener('click', async () => {
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    currentSavePath        = folder;
    savePathEl.textContent = folder;
    localStorage.setItem('fileShare_savePath', folder);
    showToast('Save folder updated');
  }
});

if (openFolderBtn) {
  openFolderBtn.addEventListener('click', () => {
    window.electronAPI.openFolder(currentSavePath);
  });
}

// ─── IPC listeners ────────────────────────────────────────────────────────────
window.electronAPI.onFolderChanged(p => {
  currentSavePath        = p;
  savePathEl.textContent = p;
  localStorage.setItem('fileShare_savePath', p);
  showToast('Save folder updated');
});

window.electronAPI.onFileUploaded(file => {
  showToast(`📥 Uploaded: ${file}`);
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
