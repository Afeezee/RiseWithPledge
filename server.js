require('dotenv').config();

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jsonStore = require('./lib/db');
const pg = require('./lib/pg');
const brevo = require('./lib/brevo');
const blob = require('./lib/blob');
const store = require('./lib/store');
const email = require('./lib/email');

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

const db = jsonStore.load();

// Mirror seeded admins from the JSON store into Postgres on first boot,
// so SEED_ADMIN_* bootstrapping still works even when data/db.json is
// ephemeral (/tmp on Vercel). Best-effort.
if (pg.enabled()) {
  store.syncAdminsToPg().catch(err => console.warn('[boot] admin pg sync failed:', err && err.message));
}

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

function requireCron(req, res, next) {
  const expected = process.env.CRON_SECRET || '';
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!expected) return res.status(500).json({ error: 'CRON_SECRET is not configured.' });
  if (token !== expected) return res.status(401).json({ error: 'Bad cron secret.' });
  next();
}

function clean(str, max = 2000) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, max);
}

function cleanDate(str) {
  if (typeof str !== 'string') return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(str.trim()) ? str.trim() : '';
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Upload the multer file (disk-stored) to Vercel Blob (prod) or move to
 * public/uploads (local), returning { url, type } or null.
 */
async function handleUpload(file) {
  if (!file) return null;
  try {
    const buffer = fs.readFileSync(file.path);
    const res = await blob.putUpload({
      buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });
    // Clean up the temp file after a successful blob upload.
    try { fs.unlinkSync(file.path); } catch (_) { /* ignore */ }
    return { url: res.url, type: blob.inferFileType(file.mimetype, file.originalname) };
  } catch (err) {
    console.error('[upload] blob put failed:', err && err.message);
    // Fallback: keep the local file path so at least local dev works.
    if (!process.env.VERCEL) {
      return { url: '/uploads/' + path.basename(file.path), type: blob.inferFileType(file.mimetype, file.originalname) };
    }
    throw err;
  }
}

// ============================================================
// PUBLIC API
// ============================================================

app.get('/api/content', async (req, res) => {
  try {
    const content = await store.getPublicContent();
    res.json(content);
  } catch (err) {
    console.error('[public] content fetch failed:', err);
    res.status(500).json({ error: 'Failed to load site content.' });
  }
});

// ---- public form submissions ----
const SUBMISSION_TYPES = {
  member: {
    collection: 'members',
    source: 'membership',
    fields: ['name', 'email', 'phone', 'dateOfBirth', 'occupation', 'location', 'motivation'],
    metaFields: ['occupation', 'location']
  },
  volunteer: {
    collection: 'volunteers',
    source: 'volunteer',
    fields: ['name', 'email', 'phone', 'category', 'areas', 'availability', 'location', 'message'],
    metaFields: ['category', 'areas', 'availability', 'location']
  },
  pledge: {
    collection: 'pledges',
    source: 'pledge',
    fields: ['name', 'email', 'phone', 'occasion', 'occasionDate', 'supportType', 'details'],
    metaFields: ['occasion', 'occasionDate', 'supportType']
  },
  contact: {
    collection: 'contacts',
    source: 'contact',
    fields: ['name', 'email', 'phone', 'subject', 'message'],
    metaFields: ['subject']
  },
  partner: {
    collection: 'partners_enquiries',
    source: 'partner',
    fields: ['name', 'email', 'phone', 'organisation', 'partnershipType', 'message'],
    metaFields: ['organisation', 'partnershipType']
  }
};

/**
 * Push a subscriber into Postgres + fire welcome email via the configured
 * provider. Also keeps the legacy Brevo contact-list sync wired for fallback.
 * Never throws — form submissions must succeed even if email is down.
 */
async function syncSubscriber({ email: addr, fullName, phone, source, metadata, dateOfBirth }) {
  let subRow = null;
  if (pg.enabled()) {
    try {
      const result = await pg.upsertSubscriber({ email: addr, fullName, phone, source, metadata, dateOfBirth });
      subRow = result.row;
      console.log('[subscribers] pg upsert ok:', source, addr, subRow ? '(id ' + subRow.id + ')' : '');
    } catch (err) {
      console.error('[subscribers] pg upsert failed:', source, addr, err && err.message);
    }
  }

  // Fire welcome email via configured provider (Resend by default, Brevo fallback).
  try {
    const result = await email.sendWelcome(source, {
      email: addr,
      fullName,
      unsubscribeToken: subRow ? subRow.unsubscribe_token : null
    });
    console.log('[subscribers] welcome email sent:', source, addr, 'via', email.providerName(), result && result.id ? 'id=' + result.id : '');
  } catch (err) {
    console.error('[subscribers] welcome email failed:', source, addr, err && err.message);
  }

  // Keep the Brevo contact-list sync running when Brevo is configured — this is
  // the "fallback" path so a separate Brevo campaign can still target the lists.
  if (brevo.enabled()) {
    try {
      const brevoId = await brevo.upsertContact({
        email: addr, fullName, source, attributes: metadata || {}
      });
      if (brevoId && subRow) {
        try { await pg.setBrevoContactId(subRow.id, brevoId); } catch (_) { /* non-critical */ }
      }
    } catch (err) {
      console.warn('[subscribers] brevo contact sync (fallback) failed:', source, addr, err && err.message);
    }
  }
}

app.post('/api/submit/:type', async (req, res) => {
  const spec = SUBMISSION_TYPES[req.params.type];
  if (!spec) return res.status(404).json({ error: 'Unknown form' });

  const name = clean(req.body.name, 200);
  const addr = clean(req.body.email, 200);
  if (!name || !addr) return res.status(400).json({ error: 'Name and email are required.' });
  if (!addr.includes('@')) return res.status(400).json({ error: 'A valid email is required.' });

  const entry = {};
  for (const f of spec.fields) {
    entry[f] = f === 'dateOfBirth' ? cleanDate(req.body[f]) : clean(req.body[f]);
  }

  try {
    await store.insertSubmission(spec.collection, entry);
  } catch (err) {
    console.error('[submit] insert failed:', err);
    return res.status(500).json({ error: 'Could not record your submission. Please try again.' });
  }

  const metadata = {};
  for (const f of spec.metaFields || []) {
    if (entry[f]) metadata[f.toUpperCase()] = entry[f];
  }

  // Fire-and-forget sync + welcome email.
  syncSubscriber({
    email: entry.email.toLowerCase(),
    fullName: entry.name,
    phone: entry.phone,
    source: spec.source,
    metadata: Object.keys(metadata).length ? metadata : null,
    dateOfBirth: entry.dateOfBirth || null
  });

  res.json({ ok: true });
});

app.post('/api/subscribe', async (req, res) => {
  const addr = clean(req.body.email, 200).toLowerCase();
  const fullName = clean(req.body.name || req.body.fullName || '', 200);
  if (!addr || !addr.includes('@')) return res.status(400).json({ error: 'A valid email is required.' });

  try {
    await store.insertSubmission('newsletter', { email: addr, fullName });
  } catch (err) {
    console.error('[subscribe] insert failed:', err);
    // Don't block the subscriber sync below; a duplicate here is fine.
  }

  syncSubscriber({
    email: addr,
    fullName: fullName || undefined,
    source: 'newsletter',
    metadata: null
  });
  res.json({ ok: true });
});

// ---- Public unsubscribe page (hit from email footer links) ----
app.get('/unsubscribe/:token', async (req, res) => {
  const token = String(req.params.token || '').trim();
  let status = 'ok';
  let message = 'You have been unsubscribed.';
  if (!pg.enabled()) {
    status = 'error';
    message = 'Unsubscribe is not available in this environment.';
  } else if (!/^[0-9a-f-]{32,}$/i.test(token)) {
    status = 'error';
    message = 'Invalid unsubscribe link.';
  } else {
    try {
      const rows = await pg.markUnsubscribedByToken(token);
      if (!rows.length) {
        status = 'error';
        message = 'This link is no longer valid — you may already be unsubscribed.';
      }
    } catch (err) {
      console.error('[unsubscribe] failed:', err);
      status = 'error';
      message = 'Something went wrong. Please try again later.';
    }
  }
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Unsubscribed — Rise With Pledge</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:Arial,sans-serif;background:#f6f7fb;color:#222;margin:0;padding:48px 24px;text-align:center}
.card{max-width:520px;margin:0 auto;background:#fff;padding:32px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.08)}
h1{margin:0 0 12px;color:#0042ab}a{color:#0042ab}</style></head>
<body><div class="card">
  <h1>${status === 'ok' ? 'You\'ve been unsubscribed' : 'We couldn\'t unsubscribe you'}</h1>
  <p>${message}</p>
  <p><a href="/">← Return to risewithpledge.org</a></p>
</div></body></html>`);
});

// ---- Email provider webhooks ----
// Brevo (legacy): POST /api/webhooks/brevo?secret=…
app.post('/api/webhooks/brevo', async (req, res) => {
  const secret = process.env.BREVO_WEBHOOK_SECRET || '';
  if (secret && req.query.secret !== secret) return res.status(401).json({ error: 'bad secret' });
  const body = req.body || {};
  const event = String(body.event || '').toLowerCase();
  const addr = String(body.email || '').toLowerCase();
  if (!addr) return res.status(400).json({ error: 'missing email' });
  if (event === 'unsubscribe' || event === 'list_unsubscribe' || event === 'spam') {
    try { await pg.markUnsubscribedByEmail(addr); } catch (err) { console.error('[brevo webhook]', err); }
  }
  res.json({ ok: true });
});

// Resend: POST /api/webhooks/resend (Svix-signed; fallback to secret query param for simplicity).
app.post('/api/webhooks/resend', async (req, res) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET || '';
  if (secret && req.query.secret !== secret) {
    return res.status(401).json({ error: 'bad secret' });
  }
  const body = req.body || {};
  const type = String(body.type || '').toLowerCase();
  const data = body.data || {};
  const to = Array.isArray(data.to) ? data.to[0] : data.to;
  if (!to) return res.status(400).json({ error: 'missing recipient' });
  // email.bounced, email.complained, email.unsubscribed — flip subscribed=false.
  if (type === 'email.bounced' || type === 'email.complained' || type === 'email.unsubscribed') {
    try {
      await pg.markUnsubscribedByEmail(String(to).toLowerCase());
      console.log('[resend webhook]', type, to);
    } catch (err) { console.error('[resend webhook]', err); }
  }
  res.json({ ok: true });
});

// ============================================================
// ADMIN API
// ============================================================

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body || {};
  try {
    const admin = await store.findAdmin(String(username || '').trim().toLowerCase());
    if (admin && jsonStore.verifyPassword(String(password || ''), admin.salt, admin.hash)) {
      req.session.isAdmin = true;
      req.session.adminUser = admin.username;
      return res.json({ ok: true, username: admin.username });
    }
    res.status(401).json({ error: 'Invalid username or password.' });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Login error.' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/session', (req, res) => {
  res.json({ loggedIn: !!(req.session && req.session.isAdmin), username: req.session && req.session.adminUser });
});

app.post('/api/admin/password', requireAdmin, async (req, res) => {
  const { current, next } = req.body || {};
  try {
    const admin = await store.findAdmin(req.session.adminUser);
    if (!admin) return res.status(400).json({ error: 'Account not found — please log in again.' });
    if (!jsonStore.verifyPassword(String(current || ''), admin.salt, admin.hash)) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    if (!next || String(next).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = jsonStore.hashPassword(String(next), salt);
    await store.updateAdminPassword(req.session.adminUser, salt, hash);
    res.json({ ok: true });
  } catch (err) {
    console.error('[password]', err);
    res.status(500).json({ error: 'Could not update password.' });
  }
});

app.get('/api/admin/data', requireAdmin, async (req, res) => {
  try {
    const data = await store.getAllContentForAdmin();
    res.json(data);
  } catch (err) {
    console.error('[admin/data]', err);
    res.status(500).json({ error: 'Failed to load dashboard data.' });
  }
});

// ---- settings & impact ----
app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const keys = Object.keys(db.settings);
    const patch = {};
    for (const k of keys) if (req.body[k] !== undefined) patch[k] = clean(req.body[k], 500);
    const settings = await store.patchSettings(patch, keys);
    res.json({ ok: true, settings });
  } catch (err) {
    console.error('[settings]', err);
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

app.put('/api/admin/impact', requireAdmin, async (req, res) => {
  try {
    const keys = Object.keys(db.impact);
    const impact = await store.patchImpact(req.body || {}, keys);
    res.json({ ok: true, impact });
  } catch (err) {
    console.error('[impact]', err);
    res.status(500).json({ error: 'Failed to save impact stats.' });
  }
});

// ---- content collections (CRUD, with optional file upload) ----
const CONTENT_FIELDS = {
  team:     ['name', 'role', 'category', 'bio'],
  projects: ['title', 'status', 'description', 'location', 'date'],
  stories:  ['title', 'content', 'personName', 'date'],
  news:     ['title', 'category', 'content', 'eventDate', 'location'],
  gallery:  ['title', 'mediaType', 'description'],
  reports:  ['title', 'category', 'year', 'description'],
  partners: ['name', 'website']
};

app.post('/api/admin/content/:collection', requireAdmin, upload.single('file'), async (req, res) => {
  const fields = CONTENT_FIELDS[req.params.collection];
  if (!fields) return res.status(404).json({ error: 'Unknown collection' });
  try {
    const data = {};
    for (const f of fields) data[f] = clean(req.body[f]);
    const uploaded = await handleUpload(req.file);
    const entry = await store.insertContent(req.params.collection, data, uploaded);
    res.json({ ok: true, entry });
  } catch (err) {
    console.error('[content create]', err);
    res.status(500).json({ error: err.message || 'Failed to publish.' });
  }
});

app.put('/api/admin/content/:collection/:id', requireAdmin, upload.single('file'), async (req, res) => {
  const fields = CONTENT_FIELDS[req.params.collection];
  if (!fields) return res.status(404).json({ error: 'Unknown collection' });
  try {
    const patch = {};
    for (const f of fields) if (req.body[f] !== undefined) patch[f] = clean(req.body[f]);
    const uploaded = await handleUpload(req.file);
    // If a new file was uploaded, delete the old one before overwriting the pointer.
    if (uploaded) {
      // Best-effort — find the current record to pull its old file url.
      const current = await store.getAllContentForAdmin();
      const existing = (current[req.params.collection] || []).find(x => x.id === req.params.id);
      if (existing && existing.file) {
        try { await blob.deleteUpload(existing.file); } catch (_) { /* ignore */ }
      }
    }
    const entry = await store.updateContent(req.params.collection, req.params.id, patch, uploaded);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, entry });
  } catch (err) {
    console.error('[content update]', err);
    res.status(500).json({ error: err.message || 'Failed to save.' });
  }
});

app.delete('/api/admin/content/:collection/:id', requireAdmin, async (req, res) => {
  if (!CONTENT_FIELDS[req.params.collection]) return res.status(404).json({ error: 'Unknown collection' });
  try {
    const removed = await store.deleteContent(req.params.collection, req.params.id);
    if (!removed) return res.status(404).json({ error: 'Not found' });
    if (removed.fileUrl) {
      try { await blob.deleteUpload(removed.fileUrl); } catch (_) { /* ignore */ }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[content delete]', err);
    res.status(500).json({ error: err.message || 'Failed to delete.' });
  }
});

// ---- submissions management ----
const SUBMISSION_COLLECTIONS = new Set(['members', 'volunteers', 'pledges', 'contacts', 'partners_enquiries', 'newsletter']);

app.put('/api/admin/submissions/:collection/:id', requireAdmin, async (req, res) => {
  if (!SUBMISSION_COLLECTIONS.has(req.params.collection)) return res.status(404).json({ error: 'Unknown collection' });
  try {
    const patch = {};
    if (req.body.status !== undefined) patch.status = clean(req.body.status, 50);
    if (req.body.note !== undefined)   patch.note   = clean(req.body.note, 1000);
    const entry = await store.updateSubmission(req.params.collection, req.params.id, patch);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, entry });
  } catch (err) {
    console.error('[submission update]', err);
    res.status(500).json({ error: 'Failed to save.' });
  }
});

app.delete('/api/admin/submissions/:collection/:id', requireAdmin, async (req, res) => {
  if (!SUBMISSION_COLLECTIONS.has(req.params.collection)) return res.status(404).json({ error: 'Unknown collection' });
  try {
    const ok = await store.deleteSubmission(req.params.collection, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[submission delete]', err);
    res.status(500).json({ error: 'Failed to delete.' });
  }
});

// ============================================================
// ADMIN — CAMPAIGNS
// ============================================================

const VALID_AUDIENCES = new Set(['newsletter', 'volunteer', 'membership', 'pledge', 'partner', 'contact']);

function requirePg(res) {
  if (!pg.enabled()) {
    res.status(503).json({ error: 'DATABASE_URL is not configured on the server.' });
    return false;
  }
  return true;
}

// Brevo-specific diagnostic (kept for the "fallback" case).
app.get('/api/admin/diagnostics/brevo', requireAdmin, async (req, res) => {
  const report = {
    envConfigured: {
      BREVO_API_KEY: !!process.env.BREVO_API_KEY,
      BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL || null,
      lists: {
        newsletter: process.env.BREVO_LIST_NEWSLETTER || null,
        volunteer:  process.env.BREVO_LIST_VOLUNTEER || null,
        membership: process.env.BREVO_LIST_MEMBERSHIP || null,
        pledge:     process.env.BREVO_LIST_PLEDGE || null,
        partner:    process.env.BREVO_LIST_PARTNER || null,
        contact:    process.env.BREVO_LIST_CONTACT || null
      }
    },
    apiKeyWorks: null, account: null, senderVerified: null, listChecks: {}, error: null
  };
  if (!brevo.enabled()) { report.error = 'BREVO_API_KEY is not set.'; return res.json(report); }
  try {
    const acc = await fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': process.env.BREVO_API_KEY, Accept: 'application/json' }
    });
    if (!acc.ok) {
      report.apiKeyWorks = false;
      report.error = 'GET /v3/account failed (' + acc.status + '): ' + (await acc.text());
      return res.json(report);
    }
    const accData = await acc.json();
    report.apiKeyWorks = true;
    report.account = {
      email: accData.email, companyName: accData.companyName,
      plan: (accData.plan || []).map(p => ({ type: p.type, credits: p.credits, creditsType: p.creditsType }))
    };
    if (process.env.BREVO_SENDER_EMAIL) {
      const sr = await fetch('https://api.brevo.com/v3/senders', {
        headers: { 'api-key': process.env.BREVO_API_KEY, Accept: 'application/json' }
      });
      const sd = sr.ok ? await sr.json() : { senders: [] };
      const match = (sd.senders || []).find(s => (s.email || '').toLowerCase() === process.env.BREVO_SENDER_EMAIL.toLowerCase());
      report.senderVerified = match ? { active: !!match.active, name: match.name } : false;
    }
    for (const [source, id] of Object.entries(report.envConfigured.lists)) {
      if (!id) { report.listChecks[source] = { configured: false }; continue; }
      const lr = await fetch('https://api.brevo.com/v3/contacts/lists/' + id, {
        headers: { 'api-key': process.env.BREVO_API_KEY, Accept: 'application/json' }
      });
      if (lr.ok) {
        const ld = await lr.json();
        report.listChecks[source] = { configured: true, id: Number(id), name: ld.name, totalSubscribers: ld.totalSubscribers, totalBlacklisted: ld.totalBlacklisted };
      } else {
        report.listChecks[source] = { configured: true, id: Number(id), error: 'GET failed (' + lr.status + ')' };
      }
    }
    res.json(report);
  } catch (err) {
    report.error = err.message;
    report.errorCause = err.cause ? { message: err.cause.message, code: err.cause.code, errno: err.cause.errno, syscall: err.cause.syscall, hostname: err.cause.hostname } : null;
    report.nodeVersion = process.version;
    res.status(200).json(report);
  }
});

// Unified email-provider diagnostic — reports Resend status + active provider.
app.get('/api/admin/diagnostics/email', requireAdmin, async (req, res) => {
  const report = await email.diagnostics();
  res.json(report);
});

app.get('/api/admin/subscribers/counts', requireAdmin, async (req, res) => {
  if (!requirePg(res)) return;
  try {
    const counts = await pg.countsBySource();
    res.json({ ok: true, counts, brevoConfigured: brevo.enabled(), provider: email.providerName() });
  } catch (err) {
    console.error('[admin] counts failed:', err);
    res.status(500).json({ error: 'Failed to load subscriber counts.' });
  }
});

app.get('/api/admin/campaigns', requireAdmin, async (req, res) => {
  if (!requirePg(res)) return;
  try {
    const rows = await pg.listCampaigns(Number(req.query.limit) || 50);
    res.json({ ok: true, campaigns: rows });
  } catch (err) {
    console.error('[admin] list campaigns failed:', err);
    res.status(500).json({ error: 'Failed to load campaigns.' });
  }
});

app.post('/api/admin/campaigns', requireAdmin, async (req, res) => {
  if (!requirePg(res)) return;
  if (!email.enabled()) return res.status(503).json({ error: 'No email provider is configured.' });

  const subject = clean(req.body.subject, 500);
  const body = clean(req.body.body, 200000);
  const audienceRaw = Array.isArray(req.body.audience) ? req.body.audience : [];
  const audience = audienceRaw.map((s) => String(s || '').toLowerCase()).filter((s) => VALID_AUDIENCES.has(s));
  const action = String(req.body.action || 'send').toLowerCase();
  const scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;
  const testEmail = clean(req.body.testEmail, 200);

  if (!subject) return res.status(400).json({ error: 'Subject is required.' });
  if (!body) return res.status(400).json({ error: 'Body is required.' });
  if (!audience.length && action !== 'test') return res.status(400).json({ error: 'Pick at least one audience.' });
  if (action === 'schedule' && (!scheduledAt || isNaN(scheduledAt.getTime()) || scheduledAt <= new Date())) {
    return res.status(400).json({ error: 'A future scheduled date/time is required.' });
  }
  if (action === 'test' && !testEmail) return res.status(400).json({ error: 'A test recipient email is required.' });

  let record = null;
  try {
    // 1) Resolve the audience and create the campaign record.
    const recipients = action === 'test'
      ? [{ email: testEmail, full_name: null, unsubscribe_token: null }]
      : await pg.activeSubscribersForSources(audience);
    const recipientCount = recipients.length;
    record = await pg.createCampaignRecord({
      subject, audience,
      status: action === 'test' ? 'test' : (action === 'schedule' ? 'scheduled' : 'sending'),
      scheduledAt: action === 'schedule' ? scheduledAt.toISOString() : null,
      sentBy: req.session.adminUser,
      recipientCount,
      provider: email.providerName(),
      htmlBody: action === 'schedule' ? body : null
    });

    if (action === 'schedule') {
      // The campaign row now holds subject + html_body + audience + scheduled_at.
      // A separate scheduler (/api/cron/campaigns) picks it up when due.
      return res.json({
        ok: true, action: 'schedule',
        scheduledAt: scheduledAt.toISOString(),
        recipientCount,
        note: 'Scheduled. Will send on the next /api/cron/campaigns tick after ' + scheduledAt.toISOString() + '. Configure a cron (cron-job.org or Vercel Cron) to call that endpoint every 5 minutes.'
      });
    }

    // 2) Send (test or send-now) via the email abstraction.
    const result = await email.sendCampaign({
      subject, html: body, recipients, campaignId: record.id
    });

    if (action === 'test') {
      return res.json({ ok: true, action: 'test', provider: email.providerName(), result });
    }
    await pg.markCampaignSent(record.id, {
      sentAt: new Date().toISOString(),
      recipientCount: result.sent,
      brevoCampaignId: result.brevoCampaignId || null
    });
    res.json({ ok: true, action: 'send', provider: email.providerName(), sent: result.sent, failed: result.failed, recipientCount });
  } catch (err) {
    console.error('[campaign send]', err);
    if (record) {
      try { await pg.markCampaignFailed(record.id, err.message); } catch (_) { /* ignore */ }
    }
    res.status(502).json({ error: err.message || 'Campaign send failed.' });
  }
});

// ============================================================
// BIRTHDAYS (admin + cron)
// ============================================================

app.get('/api/admin/birthdays', requireAdmin, async (req, res) => {
  if (!requirePg(res)) return;
  try {
    const [today, upcoming, sent] = await Promise.all([
      pg.findMembersWithBirthdayToday(),
      pg.findUpcomingBirthdays(14),
      pg.listBirthdayMessages(50)
    ]);
    res.json({ ok: true, today, upcoming, sent });
  } catch (err) {
    console.error('[birthdays list]', err);
    res.status(500).json({ error: 'Failed to load birthdays.' });
  }
});

/**
 * Run the birthday job on demand (admin-triggered). Same handler as the cron.
 */
async function runBirthdayJob({ dryRun = false } = {}) {
  if (!pg.enabled()) throw new Error('DATABASE_URL is not configured.');
  const members = await pg.findMembersWithBirthdayToday();
  const sent = [];
  const skipped = [];
  const failed = [];
  for (const m of members) {
    if (!m.email) { skipped.push({ email: null, reason: 'no email on record' }); continue; }
    try {
      const already = await pg.wasBirthdayMessageSentToday(m.id);
      if (already) { skipped.push({ email: m.email, reason: 'already greeted today' }); continue; }
      if (dryRun) { sent.push({ email: m.email, name: m.full_name, dryRun: true }); continue; }
      const result = await email.sendBirthday({
        email: m.email,
        fullName: m.full_name,
        unsubscribeToken: m.unsubscribe_token
      });
      await pg.logBirthdayMessage({
        subscriberId: m.id, email: m.email, fullName: m.full_name,
        status: 'sent', providerId: result && result.id ? result.id : null
      });
      sent.push({ email: m.email, name: m.full_name });
    } catch (err) {
      console.error('[birthday] send failed for', m.email, err && err.message);
      await pg.logBirthdayMessage({
        subscriberId: m.id, email: m.email, fullName: m.full_name,
        status: 'failed', error: err && err.message
      });
      failed.push({ email: m.email, error: err && err.message });
    }
  }
  // Digest email to admin.
  const digestTo = process.env.ADMIN_DIGEST_EMAIL;
  if (!dryRun && digestTo && (sent.length || failed.length)) {
    try { await email.sendBirthdayDigest({ to: digestTo, sent, failed, skipped }); }
    catch (err) { console.warn('[birthday] digest email failed:', err && err.message); }
  }
  return { date: new Date().toISOString().slice(0, 10), sent, failed, skipped, dryRun };
}

app.post('/api/admin/birthdays/run', requireAdmin, async (req, res) => {
  try {
    const result = await runBirthdayJob({ dryRun: req.query.dryRun === '1' });
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[birthday run]', err);
    res.status(500).json({ error: err.message || 'Birthday run failed.' });
  }
});

app.get('/api/cron/birthdays', requireCron, async (req, res) => {
  try {
    const result = await runBirthdayJob();
    console.log('[cron birthdays]', result);
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[cron birthdays]', err);
    res.status(500).json({ error: err.message || 'Birthday cron failed.' });
  }
});
// Allow POST too so external cron services (cron-job.org) can hit it either way.
app.post('/api/cron/birthdays', requireCron, async (req, res) => {
  try {
    const result = await runBirthdayJob();
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Birthday cron failed.' });
  }
});

// ============================================================
// SCHEDULED CAMPAIGNS (external cron picks these up)
// ============================================================

/**
 * Send one scheduled campaign. Returns { id, sent, failed } or { id, error }.
 * Uses optimistic locking via markCampaignSending so parallel cron hits don't
 * double-send.
 */
async function sendScheduledCampaign(campaign) {
  if (!(await pg.markCampaignSending(campaign.id))) {
    return { id: campaign.id, skipped: 'already being sent' };
  }
  try {
    const recipients = await pg.activeSubscribersForSources(campaign.audience || []);
    if (!recipients.length) {
      await pg.markCampaignSent(campaign.id, {
        sentAt: new Date().toISOString(), recipientCount: 0, brevoCampaignId: null
      });
      return { id: campaign.id, sent: 0, failed: 0, note: 'no active recipients' };
    }
    const result = await email.sendCampaign({
      subject: campaign.subject,
      html: campaign.html_body || '',
      recipients,
      campaignId: campaign.id
    });
    await pg.markCampaignSent(campaign.id, {
      sentAt: new Date().toISOString(),
      recipientCount: result.sent,
      brevoCampaignId: result.brevoCampaignId || null
    });
    return { id: campaign.id, sent: result.sent, failed: result.failed };
  } catch (err) {
    console.error('[campaign cron] send failed', campaign.id, err && err.message);
    try { await pg.markCampaignFailed(campaign.id, err.message); } catch (_) { /* ignore */ }
    return { id: campaign.id, error: err.message };
  }
}

async function runScheduledCampaignsJob() {
  if (!pg.enabled()) throw new Error('DATABASE_URL is not configured.');
  if (!email.enabled()) throw new Error('No email provider is configured.');
  const due = await pg.findDueScheduledCampaigns();
  const results = [];
  for (const c of due) results.push(await sendScheduledCampaign(c));
  return { checkedAt: new Date().toISOString(), due: due.length, results };
}

app.get('/api/cron/campaigns', requireCron, async (req, res) => {
  try {
    const result = await runScheduledCampaignsJob();
    if (result.due > 0) console.log('[cron campaigns]', result);
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[cron campaigns]', err);
    res.status(500).json({ error: err.message || 'Campaign cron failed.' });
  }
});
app.post('/api/cron/campaigns', requireCron, async (req, res) => {
  try {
    const result = await runScheduledCampaignsJob();
    if (result.due > 0) console.log('[cron campaigns]', result);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Campaign cron failed.' });
  }
});

// Admin "run now" trigger — useful for testing without waiting for the cron.
app.post('/api/admin/campaigns/run-scheduled', requireAdmin, async (req, res) => {
  try {
    const result = await runScheduledCampaignsJob();
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Run failed.' });
  }
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
    console.log('  Email provider:  ' + email.providerName());
    console.log('  Postgres:        ' + (pg.enabled() ? 'ENABLED' : 'disabled (local JSON store)'));
    console.log('  Vercel Blob:     ' + (blob.enabled() ? 'ENABLED' : 'disabled (local public/uploads)'));
    console.log('');
  });
}

module.exports = app;
