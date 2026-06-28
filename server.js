import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import http from 'http';
import cors from 'cors';
import morgan from 'morgan';
import QRCode from 'qrcode';
import { Server } from 'socket.io'; // Note the upper-case S
import { EventEmitter } from 'events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const serverEvents = new EventEmitter();

export function getNetworkIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name in interfaces) {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('vmware') || 
        lowerName.includes('virtualbox') || 
        lowerName.includes('vethernet') || 
        lowerName.includes('tailscale') ||
        lowerName.includes('zerotier')) {
      continue;
    }

    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address });
      }
    }
  }
  return ips;
}

function formatSize(bytes) {
  if (!bytes) return '0 Bytes';
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
}

function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const videoExts = ['.mp4', '.mkv', '.3gp', '.avi', '.mov'];
  const audioExts = ['.mp3', '.wav', '.m4a', '.flac'];
  const pictureExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
  const docExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt'];

  if (videoExts.includes(ext)) return 'video';
  if (audioExts.includes(ext)) return 'audio';
  if (pictureExts.includes(ext)) return 'pictures';
  if (docExts.includes(ext)) return 'documents';
  return 'files';
}

const folders = ['audio', 'video', 'pictures', 'documents', 'files'];

export async function startServer(port = 4000, uploadsDir) {
  const app = express();

  // Create folder structure
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  folders.forEach(f => {
    const folderPath = path.join(uploadsDir, f);
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
  });

  // Middleware
  app.use(cors());
  app.use(morgan('dev'));
  
  // serve mobile client UI
  app.use(express.static(path.join(__dirname, 'public')));

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*" } });
  server.timeout = 60 * 60 * 1000;

  // Upload endpoint
  app.post('/upload', (req, res) => {
    const filename = req.query.filename;
    if (!filename) return res.status(400).send("Filename required");

    const totalBytes = parseInt(req.headers['content-length'] || 0);
    let uploadedBytes = 0;

    const type = getFileType(filename); 
    const folderPath = path.join(uploadsDir, type);

    const decoded = decodeURIComponent(filename);
    let baseName = path.basename(decoded);
    let name = path.parse(baseName).name;
    let ext = path.parse(baseName).ext;

    let filePath = path.join(folderPath, baseName);
    let counter = 1;
    while (fs.existsSync(filePath)) {
      filePath = path.join(folderPath, `${name}_${counter}${ext}`);
      counter++;
    }

    const writeStream = fs.createWriteStream(filePath, { highWaterMark: 1024 * 1024 });
    const socketId = req.query.socketId;
    const uploadId = req.query.uploadId;

    req.on('data', (chunk) => {
      uploadedBytes += chunk.length;
      if (totalBytes > 0) {
        const progress = Math.round((uploadedBytes / totalBytes) * 100);
        if (socketId) {
          io.to(socketId).emit('uploadProgress', { filename: baseName, progress, uploadId });
        } else {
          io.emit('uploadProgress', { filename: baseName, progress, uploadId });
        }
        serverEvents.emit('uploadProgress', { filename: baseName, progress, uploadId });
      }
    });

    req.pipe(writeStream);

    req.on('aborted', () => {
      writeStream.destroy();
      fs.unlink(filePath, () => { });
    });

    writeStream.on('finish', () => {
      res.status(200).json({ success: true, folder: type, filename: path.basename(filePath) });
    });

    writeStream.on('error', (err) => {
      res.status(500).send("Upload failed");
    });
  });

  // Download endpoint
  app.get('/download/:type/:filename', (req, res) => {
    const { type, filename } = req.params;
    if (!folders.includes(type)) return res.status(400).send("Invalid folder type");

    const filePath = path.join(uploadsDir, type, filename);
    if (!fs.existsSync(filePath)) return res.status(404).send("File not found");

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
        return res.end();
      }

      const chunkSize = (end - start) + 1;
      const readStream = fs.createReadStream(filePath, { start, end, highWaterMark: 1024 * 1024 });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'application/octet-stream'
      });

      readStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'application/octet-stream',
        'Accept-Ranges': 'bytes'
      });
      fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 }).pipe(res);
    }
  });

  // File list endpoint
  app.get('/api/files', (req, res) => {
    try {
      const allFiles = [];
      folders.forEach(type => {
        const folderPath = path.join(uploadsDir, type);
        if (fs.existsSync(folderPath)) {
            const files = fs.readdirSync(folderPath).map(f => {
              const stats = fs.statSync(path.join(folderPath, f));
              return {
                name: f,
                size: formatSize(stats.size),
                date: stats.mtime.toLocaleString(),
                type
              };
            });
            allFiles.push(...files);
        }
      });
      res.json(allFiles);
    } catch (err) {
      res.status(500).json({ error: 'Failed to read files' });
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, '0.0.0.0', async () => {
      const ips = getNetworkIPs();
      const entries = [];
      for (const { name, address } of ips) {
        const url = `http://${address}:${port}`;
        const qrDataUrl = await QRCode.toDataURL(url, { width: 220, margin: 2, color: { dark: '#000', light: '#fff' } });
        entries.push({ name, address, url, qrDataUrl });
      }
      resolve({ server, io, entries, port });
    });
    server.on('error', reject);
  });
}

export async function stopServer(serverObj) {
  if (serverObj) {
      return new Promise((resolve) => {
          let resolved = false;
          const done = () => {
              if (!resolved) {
                  resolved = true;
                  resolve(true);
              }
          };

          if (serverObj.io) {
              // io.close() gracefully disconnects clients and closes the underlying HTTP server
              serverObj.io.close(done);
          } else if (serverObj.server) {
              serverObj.server.close(done);
          } else {
              done();
          }
          
          // Fallback to prevent indefinite hanging (e.g., if there are keep-alive HTTP connections)
          setTimeout(done, 1000);
      });
  }
  return true;
}
