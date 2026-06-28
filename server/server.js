// server/server.js
// Integrates the streaming logic from sharer/index.js with Socket.IO real-time progress

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const { getLocalIP } = require('./network-utils');

// Supported folder categories
const FOLDERS = ['audio', 'video', 'pictures', 'documents', 'files'];

// ─── Helpers ────────────────────────────────────────────────────────────────

function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const videoExts    = ['.mp4', '.mkv', '.3gp', '.avi', '.mov', '.webm'];
  const audioExts    = ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'];
  const pictureExts  = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
  const docExts      = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.ppt', '.pptx', '.csv'];

  if (videoExts.includes(ext))   return 'video';
  if (audioExts.includes(ext))   return 'audio';
  if (pictureExts.includes(ext)) return 'pictures';
  if (docExts.includes(ext))     return 'documents';
  return 'files';
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
}

// ─── Server Factory ─────────────────────────────────────────────────────────

function startServer(folderPath) {
  console.log('Starting server, uploads folder:', folderPath);

  return new Promise((resolve, reject) => {
    const app    = express();
    const server = http.createServer(app);

    // Socket.IO for real-time upload progress
    const io = new Server(server, { cors: { origin: '*' } });

    // ── Middleware ────────────────────────────────────────────────────────
    app.use(cors());
    app.use(express.json());

    // Serve the phone-facing web UI from public/
    app.use(express.static(path.join(__dirname, '..', 'public')));

    // ── Create upload sub-folders ─────────────────────────────────────────
    const uploadsDir = folderPath;
    FOLDERS.forEach(f => {
      const fp = path.join(uploadsDir, f);
      if (!fs.existsSync(fp)) fs.mkdirSync(fp, { recursive: true });
    });

    // ── STREAMING UPLOAD with per-client progress ─────────────────────────
    app.post('/upload', (req, res) => {
      const filename = req.query.filename;

      if (filename) {
        // — Streaming style (used by public/index.html) —
        const totalBytes = parseInt(req.headers['content-length'] || 0);
        let uploadedBytes = 0;

        const type       = getFileType(filename);
        const folderPath = path.join(uploadsDir, type);

        const decoded  = decodeURIComponent(filename);
        let baseName   = path.basename(decoded);
        let name       = path.parse(baseName).name;
        let ext        = path.parse(baseName).ext;

        // Auto-rename on collision: file.jpg → file_1.jpg → file_2.jpg …
        let filePath = path.join(folderPath, baseName);
        let counter  = 1;
        while (fs.existsSync(filePath)) {
          filePath = path.join(folderPath, `${name}_${counter}${ext}`);
          counter++;
        }

        const writeStream = fs.createWriteStream(filePath, { highWaterMark: 1024 * 1024 });

        const socketId = req.query.socketId;
        const uploadId = req.query.uploadId;

        req.on('data', chunk => {
          uploadedBytes += chunk.length;
          if (totalBytes > 0) {
            const progress = Math.round((uploadedBytes / totalBytes) * 100);
            if (socketId) {
              io.to(socketId).emit('uploadProgress', { filename: baseName, progress, uploadId });
            } else {
              io.emit('uploadProgress', { filename: baseName, progress, uploadId });
            }
          }
        });

        req.pipe(writeStream);

        req.on('aborted', () => {
          writeStream.destroy();
          fs.unlink(filePath, () => {});
          console.log('Upload aborted:', path.basename(filePath));
        });

        writeStream.on('finish', () => {
          console.log('Upload completed:', path.basename(filePath));
          res.status(200).json({
            success: true,
            folder: type,
            filename: path.basename(filePath),
            message: `${path.basename(filePath)} uploaded successfully`
          });
        });

        writeStream.on('error', err => {
          console.error('Write error:', err);
          res.status(500).json({ success: false, error: 'Upload failed' });
        });

      } else {
        // — Multer/FormData style (used by file-browser.html / upload.html) —
        const multer  = require('multer');
        const storage = multer.diskStorage({
          destination: (req, file, cb) => {
            const type     = getFileType(file.originalname);
            const destPath = path.join(uploadsDir, type);
            cb(null, destPath);
          },
          filename: (req, file, cb) => {
            let baseName = file.originalname;
            let name     = path.parse(baseName).name;
            let ext      = path.parse(baseName).ext;

            const type       = getFileType(file.originalname);
            const folderPath = path.join(uploadsDir, type);
            let filePath     = path.join(folderPath, baseName);
            let counter      = 1;

            while (fs.existsSync(filePath)) {
              filePath = path.join(folderPath, `${name}_${counter}${ext}`);
              counter++;
            }
            cb(null, path.basename(filePath));
          }
        });

        const upload = multer({ storage });
        upload.array('files')(req, res, err => {
          if (err) return res.status(500).json({ success: false, error: err.message });
          if (!req.files || !req.files.length)
            return res.status(400).json({ success: false, error: 'No files uploaded' });

          res.json({
            success: true,
            message: `${req.files.length} file(s) uploaded successfully`,
            files: req.files.map(f => ({
              name: f.filename,
              size: formatSize(f.size),
              type: getFileType(f.originalname)
            }))
          });
        });
      }
    });

    // ── STREAMING DOWNLOAD ───────────────────────────────────────────────
    app.get('/download/:type/:filename', (req, res) => {
      const { type, filename } = req.params;
      if (!FOLDERS.includes(type)) return res.status(400).send('Invalid folder type');

      const filePath = path.join(uploadsDir, type, filename);
      if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

      const stat     = fs.statSync(filePath);
      const fileSize = stat.size;
      const range    = req.headers.range;

      if (range) {
        const parts     = range.replace(/bytes=/, '').split('-');
        const start     = parseInt(parts[0], 10);
        const end       = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize) {
          res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
          return res.end();
        }

        const chunkSize  = end - start + 1;
        const readStream = fs.createReadStream(filePath, { start, end, highWaterMark: 1024 * 1024 });

        res.writeHead(206, {
          'Content-Range':       `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges':       'bytes',
          'Content-Length':      chunkSize,
          'Content-Type':        'application/octet-stream',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`
        });

        readStream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length':      fileSize,
          'Content-Type':        'application/octet-stream',
          'Accept-Ranges':       'bytes',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`
        });
        fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 }).pipe(res);
      }
    });

    // Legacy download route – search across all sub-folders
    app.get('/download/:filename', (req, res) => {
      const fileName = req.params.filename;
      let foundType  = null;

      for (const type of FOLDERS) {
        if (fs.existsSync(path.join(uploadsDir, type, fileName))) {
          foundType = type;
          break;
        }
      }

      if (!foundType) return res.status(404).send('File not found');
      res.redirect(`/download/${foundType}/${fileName}`);
    });

    // ── FILE LIST API ────────────────────────────────────────────────────
    app.get('/api/files', (req, res) => {
      try {
        const allFiles = [];
        FOLDERS.forEach(type => {
          const fp = path.join(uploadsDir, type);
          if (fs.existsSync(fp)) {
            const files = fs.readdirSync(fp).map(f => {
              const stats = fs.statSync(path.join(fp, f));
              return {
                name:          f,
                size:          stats.size,
                formattedSize: formatSize(stats.size),
                date:          stats.mtime,
                type,
                path:          `${type}/${f}`
              };
            });
            allFiles.push(...files);
          }
        });

        // Sort by date, newest first
        allFiles.sort((a, b) => b.date - a.date);
        res.json({ success: true, files: allFiles });
      } catch (err) {
        console.error('Error reading files:', err);
        res.status(500).json({ success: false, error: 'Failed to read folder' });
      }
    });

    // ── START ────────────────────────────────────────────────────────────
    const port = process.env.PORT || 3000;
    server.timeout = 60 * 60 * 1000; // 1 hour for large uploads

    server.listen(port, '0.0.0.0', () => {
      const localIP = getLocalIP();
      const url     = `http://${localIP}:${port}`;
      console.log(`Server running at ${url}`);
      console.log(`Upload folders: ${FOLDERS.join(', ')}`);
      resolve({ server, io, app, url, port });
    });

    server.on('error', err => reject(err));
  });
}

// ─── Stop Server ─────────────────────────────────────────────────────────────

function stopServer(serverInstance) {
  return new Promise((resolve, reject) => {
    const httpServer =
      serverInstance && serverInstance.server
        ? serverInstance.server
        : serverInstance;

    if (httpServer && typeof httpServer.close === 'function' && httpServer.listening) {
      httpServer.close(err => {
        if (err) {
          console.error('Error stopping server:', err);
          reject(err);
        } else {
          console.log('Server stopped successfully');
          resolve();
        }
      });
    } else {
      console.log('Server was not running');
      resolve();
    }
  });
}

module.exports = { startServer, stopServer };
