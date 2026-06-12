const express = require('express');
const session = require('express-session');
const multer = require('multer');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./lib/db');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = process.env.RWP_UPLOAD_DIR || (process.env.VERCEL
  ? path.join(os.tmpdir(), 'risewithpledge', 'uploads')
  : path.join(PUBLIC_DIR, 'uploads'));
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const SESSION_SECRET = process.env.SESSION_SECRET || (!process.env.VERCEL
  ? crypto.randomBytes(32).toString('hex')
  : '');

if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set when running on Vercel.');
}

const db = store.load();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
}));

// ---------- uploads ----------
const ALLOWED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.mp4', '.webm', '.pdf',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'
]);
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_EXT.has(ext));
  }
});

// ---------- helpers ----------
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Not authorised' });
}

function clean(str, max = 2000) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, max);
}

function nowIso() {
  return new Date().toISOString();
}

// ============================================================
// PUBLIC API
// ============================================================

// All public content in one call (settings, impact, content collections)
app.get('/api/content', (req, res) => {
  res.json({
    settings: db.settings,
    impact: db.impact,
    team: db.team,
    projects: db.projects,
    stories: db.stories,
    news: db.news,
    gallery: db.gallery,
    reports: db.reports,
    partners: db.partners
  });
});

// ---- public form submissions ----
const SUBMISSION_TYPES = {
  member: {
    collection: 'members',
    fields: ['name', 'email', 'phone', 'occupation', 'location', 'motivation']
  },
  volunteer: {
    collection: 'volunteers',
    fields: ['name', 'email', 'phone', 'category', 'areas', 'availability', 'location', 'message']
  },
  pledge: {
    collection: 'pledges',
    fields: ['name', 'email', 'phone', 'occasion', 'occasionDate', 'supportType', 'details']
  },
  contact: {
    collection: 'contacts',
    fields: ['name', 'email', 'phone', 'subject', 'message']
  }
};

app.post('/api/submit/:type', (req, res) => {
  const spec = SUBMISSION_TYPES[req.params.type];
  if (!spec) return res.status(404).json({ error: 'Unknown form' });

  const name = clean(req.body.name, 200);
  const email = clean(req.body.email, 200);
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' });

  const entry = { id: store.id(), date: nowIso(), status: 'new' };
  for (const f of spec.fields) entry[f] = clean(req.body[f]);
  db[spec.collection].unshift(entry);
  store.save();
  res.json({ ok: true });
});

app.post('/api/subscribe', (req, res) => {
  const email = clean(req.body.email, 200).toLowerCase();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid email is required.' });
  if (!db.newsletter.some(n => n.email === email)) {
    db.newsletter.unshift({ id: store.id(), email, date: nowIso() });
    store.save();
  }
  res.json({ ok: true });
});

// ============================================================
// ADMIN API
// ============================================================

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  const admin = db.admins.find(a => a.username === String(username || '').trim().toLowerCase());
  if (admin && store.verifyPassword(String(password || ''), admin.salt, admin.hash)) {
    req.session.isAdmin = true;
    req.session.adminUser = admin.username;
    return res.json({ ok: true, username: admin.username });
  }
  res.status(401).json({ error: 'Invalid username or password.' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/session', (req, res) => {
  res.json({ loggedIn: !!(req.session && req.session.isAdmin), username: req.session && req.session.adminUser });
});

// Changes the password of the currently signed-in admin only
app.post('/api/admin/password', requireAdmin, (req, res) => {
  const { current, next } = req.body || {};
  const admin = db.admins.find(a => a.username === req.session.adminUser);
  if (!admin) return res.status(400).json({ error: 'Account not found — please log in again.' });
  if (!store.verifyPassword(String(current || ''), admin.salt, admin.hash)) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  if (!next || String(next).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  admin.salt = crypto.randomBytes(16).toString('hex');
  admin.hash = store.hashPassword(String(next), admin.salt);
  store.save();
  res.json({ ok: true });
});

// Everything the dashboard needs in one call (credentials excluded)
app.get('/api/admin/data', requireAdmin, (req, res) => {
  const { admins, admin, ...safe } = db;
  res.json(safe);
});

// ---- settings & impact ----
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  for (const key of Object.keys(db.settings)) {
    if (req.body[key] !== undefined) db.settings[key] = clean(req.body[key], 500);
  }
  store.save();
  res.json({ ok: true, settings: db.settings });
});

app.put('/api/admin/impact', requireAdmin, (req, res) => {
  for (const key of Object.keys(db.impact)) {
    if (req.body[key] !== undefined) {
      const n = Number(req.body[key]);
      db.impact[key] = Number.isFinite(n) && n >= 0 ? n : 0;
    }
  }
  store.save();
  res.json({ ok: true, impact: db.impact });
});

// ---- content collections (CRUD, with optional file upload) ----
const CONTENT_COLLECTIONS = {
  team: ['name', 'role', 'category', 'bio'],
  projects: ['title', 'status', 'description', 'location', 'date'],
  stories: ['title', 'content', 'personName', 'date'],
  news: ['title', 'category', 'content', 'eventDate', 'location'],
  gallery: ['title', 'mediaType', 'description'],
  reports: ['title', 'category', 'year', 'description'],
  partners: ['name', 'website']
};

app.post('/api/admin/content/:collection', requireAdmin, upload.single('file'), (req, res) => {
  const fields = CONTENT_COLLECTIONS[req.params.collection];
  if (!fields) return res.status(404).json({ error: 'Unknown collection' });
  const entry = { id: store.id(), createdAt: nowIso() };
  for (const f of fields) entry[f] = clean(req.body[f]);
  if (req.file) entry.file = '/uploads/' + req.file.filename;
  db[req.params.collection].unshift(entry);
  store.save();
  res.json({ ok: true, entry });
});

app.put('/api/admin/content/:collection/:id', requireAdmin, upload.single('file'), (req, res) => {
  const fields = CONTENT_COLLECTIONS[req.params.collection];
  if (!fields) return res.status(404).json({ error: 'Unknown collection' });
  const item = db[req.params.collection].find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  for (const f of fields) {
    if (req.body[f] !== undefined) item[f] = clean(req.body[f]);
  }
  if (req.file) {
    removeUpload(item.file);
    item.file = '/uploads/' + req.file.filename;
  }
  store.save();
  res.json({ ok: true, entry: item });
});

app.delete('/api/admin/content/:collection/:id', requireAdmin, (req, res) => {
  const fields = CONTENT_COLLECTIONS[req.params.collection];
  if (!fields) return res.status(404).json({ error: 'Unknown collection' });
  const idx = db[req.params.collection].findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  removeUpload(db[req.params.collection][idx].file);
  db[req.params.collection].splice(idx, 1);
  store.save();
  res.json({ ok: true });
});

function removeUpload(filePath) {
  if (!filePath || !filePath.startsWith('/uploads/')) return;
  const abs = path.join(UPLOAD_DIR, path.basename(filePath));
  if (fs.existsSync(abs)) {
    try { fs.unlinkSync(abs); } catch (e) { /* file may be locked; ignore */ }
  }
}

// ---- submissions management (members, volunteers, pledges, contacts, newsletter) ----
const SUBMISSION_COLLECTIONS = new Set(['members', 'volunteers', 'pledges', 'contacts', 'newsletter']);

app.put('/api/admin/submissions/:collection/:id', requireAdmin, (req, res) => {
  if (!SUBMISSION_COLLECTIONS.has(req.params.collection)) return res.status(404).json({ error: 'Unknown collection' });
  const item = db[req.params.collection].find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (req.body.status !== undefined) item.status = clean(req.body.status, 50);
  if (req.body.note !== undefined) item.note = clean(req.body.note, 1000);
  store.save();
  res.json({ ok: true, entry: item });
});

app.delete('/api/admin/submissions/:collection/:id', requireAdmin, (req, res) => {
  if (!SUBMISSION_COLLECTIONS.has(req.params.collection)) return res.status(404).json({ error: 'Unknown collection' });
  const idx = db[req.params.collection].findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db[req.params.collection].splice(idx, 1);
  store.save();
  res.json({ ok: true });
});

// ============================================================
// STATIC FILES & PAGES
// ============================================================

app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html'));
});

// 404 fallback for unknown pages
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('');
    console.log('  RISE WITH PLEDGE Foundation website');
    console.log('  ------------------------------------');
    console.log('  Public site:     http://localhost:' + PORT);
    console.log('  Admin dashboard: http://localhost:' + PORT + '/admin');
    console.log('  Admin access:    existing data/db.json or SEED_ADMIN_* environment variables');
    console.log('');
  });
}

module.exports = app;
