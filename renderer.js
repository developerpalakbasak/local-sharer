// renderer.js
let currentSavePath = '';
let serverRunning = false;

// DOM Elements
const savePathEl = document.getElementById('savePath');
const statusIcon = document.getElementById('statusIcon');
const statusTitle = document.getElementById('statusTitle');
const statusMessage = document.getElementById('statusMessage');
const qrSection = document.getElementById('qrSection');
const qrCode = document.getElementById('qrCode');
const serverUrl = document.getElementById('serverUrl');
const ipList = document.getElementById('ipList');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const changeFolderBtn = document.getElementById('changeFolderBtn');
// Remove this line: const openFolderBtn = document.getElementById('openFolderBtn');

// Initialize
async function init() {
    try {
        console.log('Initializing...');
        
        // Check if we have a saved path in localStorage
        const savedPath = localStorage.getItem('fileShare_savePath');
        
        if (savedPath && savedPath.trim() !== '') {
            // Use saved path if it exists
            currentSavePath = savedPath;
            console.log('Using saved path:', currentSavePath);
        } else {
            // Otherwise get default folder from main process
            console.log('Getting default folder from main...');
            currentSavePath = await window.electronAPI.getDefaultFolder();
            console.log('Default folder received:', currentSavePath);
            
            // Save it to localStorage for future use
            if (currentSavePath && currentSavePath.trim() !== '') {
                localStorage.setItem('fileShare_savePath', currentSavePath);
            }
        }
        
        // Update the UI
        if (savePathEl) {
            savePathEl.textContent = currentSavePath || 'No folder selected';
            console.log('Save path element updated with:', currentSavePath);
        } else {
            console.error('savePathEl is null!');
        }

        // Check server status
        const status = await window.electronAPI.getServerStatus();
        console.log('Server status:', status);
        
        if (status.isRunning) {
            serverRunning = true;
            updateUIForServerStart(status.url);
        }
    } catch (error) {
        console.error('Error in init:', error);
        // Fallback to a default path
        currentSavePath = 'Please select a folder';
        if (savePathEl) {
            savePathEl.textContent = currentSavePath;
        }
    }
}

// Update UI when server starts
function updateUIForServerStart(url) {
    serverRunning = true;
    statusIcon.textContent = '🟢';
    statusTitle.textContent = 'Server is running';
    statusMessage.textContent = 'Ready for connections';
    startBtn.disabled = true;
    stopBtn.disabled = false;

    // Show QR section
    qrSection.style.display = 'block';

    // Display URL
    serverUrl.textContent = url;
}

// Update UI when server stops
function updateUIForServerStop() {
    serverRunning = false;
    statusIcon.textContent = '⏸️';
    statusTitle.textContent = 'Server is stopped';
    statusMessage.textContent = 'Click start to begin sharing';
    startBtn.disabled = false;
    stopBtn.disabled = true;

    // Hide QR section
    qrSection.style.display = 'none';

    // Clear QR code
    qrCode.src = '';
}

// Display IP addresses
function displayIPs(ips) {
    ipList.innerHTML = '';
    ips.forEach(ip => {
        const ipItem = document.createElement('div');
        ipItem.className = 'ip-item';
        ipItem.textContent = `${ip.interface}: ${ip.address}`;
        ipList.appendChild(ipItem);
    });
}

// Show toast notification
function showToast(message) {
    // Remove existing toast
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Event Listeners
startBtn.addEventListener('click', async () => {
    try {
        // Validate save path
        if (!currentSavePath || currentSavePath.trim() === '' || currentSavePath === 'Please select a folder') {
            // Try to get default folder again
            currentSavePath = await window.electronAPI.getDefaultFolder();
            savePathEl.textContent = currentSavePath;
            
            if (!currentSavePath || currentSavePath.trim() === '') {
                showToast('Please select a save folder first');
                startBtn.innerHTML = '<span class="btn-icon">▶</span> Start Sharing';
                startBtn.disabled = false;
                return;
            }
        }
        
        // Show loading state
        startBtn.innerHTML = 'Start Sharing';
        startBtn.disabled = true;

        console.log('Starting server with path:', currentSavePath);
        
        // Start server
        const result = await window.electronAPI.startServer(currentSavePath);

        if (result.success) {
            updateUIForServerStart(result.url);
            displayIPs(result.ips);

            // Set QR code from the data URL received from main process
            if (result.qrCode) {
                qrCode.src = result.qrCode;
            }

            showToast('Server started successfully!');
        } else {
            showToast(`Failed to start server: ${result.error}`);
            startBtn.innerHTML = '<span class="btn-icon">▶</span> Start Sharing';
            startBtn.disabled = false;
        }
    } catch (error) {
        console.error('Failed to start server:', error);
        showToast('Failed to start server');
        startBtn.innerHTML = '<span class="btn-icon">▶</span> Start Sharing';
        startBtn.disabled = false;
    }
});

stopBtn.addEventListener('click', async () => {
    try {
        // Show loading state
        stopBtn.innerHTML = 'Stop Sharing';
        stopBtn.disabled = true;

        // Stop server
        const result = await window.electronAPI.stopServer();

        if (result.success) {
            updateUIForServerStop();
            showToast('Server stopped');
        } else {
            showToast(`Failed to stop server: ${result.error}`);
        }

        stopBtn.innerHTML = '<span class="btn-icon">⏹</span> Stop Sharing';
    } catch (error) {
        console.error('Failed to stop server:', error);
        showToast('Failed to stop server');
        stopBtn.innerHTML = '<span class="btn-icon">⏹</span> Stop Sharing';
        stopBtn.disabled = false;
    }
});

changeFolderBtn.addEventListener('click', async () => {
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
        currentSavePath = folder;
        savePathEl.textContent = folder;
        // Save to localStorage
        localStorage.setItem('fileShare_savePath', folder);
        showToast('Save folder updated');
    }
});

// Remove this entire block:
// openFolderBtn.addEventListener('click', () => {
//     window.electronAPI.openFolder(currentSavePath);
// });

// Listen for folder changes from main process
window.electronAPI.onFolderChanged((path) => {
    currentSavePath = path;
    savePathEl.textContent = path;
    // Save to localStorage
    localStorage.setItem('fileShare_savePath', path);
    showToast('Save folder updated');
});

// Listen for file uploads
window.electronAPI.onFileUploaded((file) => {
    showToast(`File uploaded: ${file}`);
});

// Initialize on load
document.addEventListener('DOMContentLoaded', init);