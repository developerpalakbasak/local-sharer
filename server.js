// server.js

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { getLocalIP } = require('./network-utils');

function startServer(folderPath) {
  console.log("folderpath:", folderPath)
  return new Promise((resolve, reject) => {
    const app = express();
    const server = http.createServer(app);

    app.use(cors());
    app.use(express.json());

    // Create subfolders for different file types
    const uploadsDir = folderPath;
    const folders = ['audio', 'video', 'pictures', 'documents', 'files'];
    
    folders.forEach(f => {
      const folderPath = path.join(uploadsDir, f);
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }
    });

    // Helper function to determine file type
    function getFileType(filename) {
      const ext = path.extname(filename).toLowerCase();
      const videoExts = ['.mp4', '.mkv', '.3gp', '.avi', '.mov', '.webm'];
      const audioExts = ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'];
      const pictureExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
      const docExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.ppt', '.pptx', '.csv'];

      if (videoExts.includes(ext)) return 'video';
      if (audioExts.includes(ext)) return 'audio';
      if (pictureExts.includes(ext)) return 'pictures';
      if (docExts.includes(ext)) return 'documents';
      return 'files';
    }

    // Helper function to format file size
    function formatSize(bytes) {
      if (!bytes || bytes === 0) return '0 Bytes';
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
    }

    // STREAMING UPLOAD with auto-rename
    app.post('/upload', (req, res) => {
      // Get filename from query parameter (to match index.js style)
      const filename = req.query.filename;
      
      // If filename is provided in query param (streaming style)
      if (filename) {
        const type = getFileType(filename);
        const folderPath = path.join(uploadsDir, type);
        
        // Decode URL-encoded filename
        const decoded = decodeURIComponent(filename);
        
        // Get only the base filename (ignore folder structure)
        let baseName = path.basename(decoded);
        
        let name = path.parse(baseName).name;
        let ext = path.parse(baseName).ext;
        
        // Check if file exists and add _1, _2, etc.
        let filePath = path.join(folderPath, baseName);
        let counter = 1;
        while (fs.existsSync(filePath)) {
          filePath = path.join(folderPath, `${name}_${counter}${ext}`);
          counter++;
        }
        
        const writeStream = fs.createWriteStream(filePath, { highWaterMark: 1024 * 1024 });
        req.pipe(writeStream);
        
        req.on('aborted', () => {
          writeStream.destroy();
          fs.unlink(filePath, () => {});
          console.log("Upload aborted:", path.basename(filePath));
        });
        
        writeStream.on('finish', () => {
          console.log("Upload completed:", path.basename(filePath));
          res.status(200).json({ 
            success: true, 
            folder: type, 
            filename: path.basename(filePath),
            message: `${path.basename(filePath)} uploaded successfully`
          });
        });
        
        writeStream.on('error', (err) => {
          console.error("Write error:", err);
          res.status(500).json({ success: false, error: "Upload failed" });
        });
      } 
      // Handle multer-style upload (for backward compatibility)
      else {
        const multer = require('multer');
        const storage = multer.diskStorage({
          destination: (req, file, cb) => {
            const type = getFileType(file.originalname);
            const destPath = path.join(uploadsDir, type);
            cb(null, destPath);
          },
          filename: (req, file, cb) => {
            let baseName = file.originalname;
            let name = path.parse(baseName).name;
            let ext = path.parse(baseName).ext;
            
            // Check if file exists and add _1, _2, etc.
            const type = getFileType(file.originalname);
            const folderPath = path.join(uploadsDir, type);
            let filePath = path.join(folderPath, baseName);
            let counter = 1;
            
            while (fs.existsSync(filePath)) {
              filePath = path.join(folderPath, `${name}_${counter}${ext}`);
              counter++;
            }
            
            cb(null, path.basename(filePath));
          }
        });
        
        const upload = multer({ storage });
        
        // Use multer middleware for this specific request
        upload.array('files')(req, res, (err) => {
          if (err) {
            return res.status(500).json({ success: false, error: err.message });
          }
          
          if (!req.files || !req.files.length) {
            return res.status(400).json({ success: false, error: 'No files uploaded' });
          }
          
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

    // STREAMING DOWNLOAD
    app.get('/download/:type/:filename', (req, res) => {
      const { type, filename } = req.params;
      const validFolders = ['audio', 'video', 'pictures', 'documents', 'files'];
      
      if (!validFolders.includes(type)) {
        return res.status(400).send("Invalid folder type");
      }

      const filePath = path.join(uploadsDir, type, filename);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).send("File not found");
      }

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
        const readStream = fs.createReadStream(filePath, { 
          start, 
          end, 
          highWaterMark: 1024 * 1024 
        });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`
        });

        readStream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': 'application/octet-stream',
          'Accept-Ranges': 'bytes',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`
        });
        fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 }).pipe(res);
      }
    });

    // Also support old download format for backward compatibility
    app.get('/download/:filename', (req, res) => {
      const fileName = req.params.filename;
      
      // Search for the file in all folders
      let foundPath = null;
      let foundType = null;
      
      const folders = ['audio', 'video', 'pictures', 'documents', 'files'];
      for (const type of folders) {
        const testPath = path.join(uploadsDir, type, fileName);
        if (fs.existsSync(testPath)) {
          foundPath = testPath;
          foundType = type;
          break;
        }
      }
      
      if (!foundPath) {
        return res.status(404).send('File not found');
      }
      
      // Redirect to the new format
      res.redirect(`/download/${foundType}/${fileName}`);
    });

    // Serve index.html
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'file-browser.html'));
    });

    // API: Get list of files in all folders
    app.get('/api/files', (req, res) => {
      try {
        const allFiles = [];
        const folders = ['audio', 'video', 'pictures', 'documents', 'files'];
        
        folders.forEach(type => {
          const folderPath = path.join(uploadsDir, type);
          if (fs.existsSync(folderPath)) {
            const files = fs.readdirSync(folderPath).map(f => {
              const filePath = path.join(folderPath, f);
              const stats = fs.statSync(filePath);
              return {
                name: f,
                size: stats.size,
                formattedSize: formatSize(stats.size),
                date: stats.mtime,
                type: type,
                path: `${type}/${f}`
              };
            });
            allFiles.push(...files);
          }
        });
        
        // Sort by date (newest first)
        allFiles.sort((a, b) => b.date - a.date);
        
        res.json({ success: true, files: allFiles });
      } catch (err) {
        console.error('Error reading files:', err);
        res.status(500).json({ success: false, error: 'Failed to read folder' });
      }
    });

    const port = process.env.PORT || 3000;
    server.listen(port, '0.0.0.0', () => {
      const localIP = getLocalIP();
      const url = `http://${localIP}:${port}`;
      console.log(`Server running at ${url}`);
      console.log(`Upload folders created: ${folders.join(', ')}`);
      // Return the server instance in the resolve
      resolve({ server, app, url, port });
    });

    server.on('error', (err) => reject(err));
  });
}


function stopServer(serverInstance) {
  return new Promise((resolve, reject) => {
    // Case 1: If we have the object with server property (from resolve)
    if (serverInstance && serverInstance.server) {
      const httpServer = serverInstance.server;
      
      // Check if server is actually listening
      if (httpServer.listening) {
        httpServer.close((err) => {
          if (err) {
            console.error('Error stopping server:', err);
            reject(err);
          } else {
            console.log('Server stopped successfully');
            resolve();
          }
        });
      } else {
        console.log('Server was not listening');
        resolve();
      }
    }
    // Case 2: If we have a direct server instance
    else if (serverInstance && typeof serverInstance.close === 'function') {
      if (serverInstance.listening) {
        serverInstance.close((err) => {
          if (err) {
            console.error('Error stopping server:', err);
            reject(err);
          } else {
            console.log('Server stopped successfully');
            resolve();
          }
        });
      } else {
        console.log('Server was not listening');
        resolve();
      }
    }
    // Case 3: No valid server instance
    else {
      console.log('No valid server instance provided');
      resolve(); // Resolve anyway as there's nothing to stop
    }
  });
}

module.exports = { startServer, stopServer };