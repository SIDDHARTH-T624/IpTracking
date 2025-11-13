// server.js
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();                // <- MUST be defined before app.use / routes
const PORT = process.env.PORT || 3000;

// If deployed behind a proxy (Heroku, Render, Vercel proxies), enable this
// app.set('trust proxy', true);

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random()*1e9) + path.extname(file.originalname);
    cb(null, unique);
  }
});
const upload = multer({ storage });

// simple JSON store for id -> filename
const IMAGES_FILE = path.join(__dirname, 'images.json');
let images = {};
if (fs.existsSync(IMAGES_FILE)) {
  try { images = JSON.parse(fs.readFileSync(IMAGES_FILE)); } catch(e){ images = {}; }
}
function saveImages() {
  fs.writeFileSync(IMAGES_FILE, JSON.stringify(images, null, 2));
}

// helper to get client IP (checks X-Forwarded-For)
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'] || req.headers['x-forwarded-for'.toLowerCase()];
  if (xff) return xff.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : req.ip || '';
}

// serve static front-end
app.use(express.static(path.join(__dirname, 'public')));

// upload endpoint
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const id = uuidv4();
  images[id] = {
    filename: req.file.filename,
    originalName: req.file.originalname,
    uploadedAt: new Date().toISOString()
  };
  saveImages();
  const downloadUrl = `${req.protocol}://${req.get('host')}/d/${id}`;
  res.json({ id, downloadUrl });
});

// download endpoint — logs IP + metadata, then streams file
app.get('/d/:id', (req, res) => {
  const id = req.params.id;
  const entry = images[id];
  if (!entry) return res.status(404).send('Not found');

  const filePath = path.join(UPLOAD_DIR, entry.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('File missing');

  const ip = getClientIp(req);
  const ua = req.get('User-Agent') || '';
  const ref = req.get('Referer') || '';
  const when = new Date().toISOString();

  const LOG_FILE = path.join(__dirname, 'downloads.csv');
  const header = 'timestamp,id,ip,user_agent,referer\n';
  const safe = s => s ? s.replace(/"/g,'""') : '';
  const row = `${when},${id},"${safe(ip)}","${safe(ua)}","${safe(ref)}"\n`;

  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, header + row);
  else fs.appendFileSync(LOG_FILE, row);

  res.download(filePath, entry.originalName, (err) => {
    if (err) console.error('Download error', err);
  });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
