require('dotenv').config();

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./lib/db');
const pg = require('./lib/pg');
const brevo = require('./lib/brevo');

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
// `source` is the subscriber-list source name used in Postgres + Brevo.
// `metaFields` are copied into subscribers.metadata (JSONB) as form-specific
// extras so we do not have to add a column per form.
const SUBMISSION_TYPES = {
  member: {
    collection: 'members',
    source: 'membership',
    fields: ['name', 'email', 'phone', 'occupation', 'location', 'motivation'],
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
    // organisation replaces "subject" as the interesting extra field
    fields: ['name', 'email', 'phone', 'organisation', 'partnershipType', 'message'],
    metaFields: ['organisation', 'partnershipType']
  }
};

// Partner enquiries are a new collection — keep the JSON store in sync so the
// existing admin submissions view can list them too.
if (!Array.isArray(db.partners_enquiries)) db.partners_enquiries = [];

/**
 * Push a subscriber into Postgres and Brevo. Never throws — a failure here
 * must not break the public-facing form submission, so we swallow and log.
 */
async function syncSubscriber({ email, fullName, phone, source, metadata }) {
  // Postgres is optional at this point — Brevo is what actually delivers the
  // welcome email, so we should still try Brevo even if Neon isn't wired up
  // yet. That makes local testing possible before provisioning Postgres.
  let subRow = null;
  if (pg.enabled()) {
    try {
      const result = await pg.upsertSubscriber({ email, fullName, phone, source, metadata });
      subRow = result.row;
      console.log('[subscribers] pg upsert ok:', source, email, subRow ? '(id ' + subRow.id + ')' : '');
    } catch (err) {
      console.error('[subscribers] Postgres upsert failed:', source, email, err && err.message);
      // fall through — we still want to try Brevo
    }
  } else {
    console.warn('[subscribers] DATABASE_URL not set — pg upsert skipped for', source, email);
  }

  if (!brevo.enabled()) {
    console.warn('[subscribers] BREVO_API_KEY not set — Brevo sync skipped for', source, email);
    return;
  }
  const list = brevo.listId(source);
  if (!list) {
    console.warn('[subscribers] BREVO_LIST_' + source.toUpperCase() + ' not set — contact will be created but not added to any list, so its welcome automation will not fire.');
  }
  try {
    const brevoId = await brevo.upsertContact({
      email,
      fullName,
      source,
      attributes: metadata || {}
    });
    console.log('[subscribers] brevo upsert ok:', source, email, 'listId=', list, brevoId ? '(created id=' + brevoId + ')' : '(updated existing contact)');
    if (brevoId && subRow) {
      try { await pg.setBrevoContactId(subRow.id, brevoId); } catch (_) { /* non-critical */ }
    }
  } catch (err) {
    console.error('[subscribers] Brevo sync FAILED:', source, email, 'listId=', list, '→', err && err.message);
  }
}

app.post('/api/submit/:type', (req, res) => {
  const spec = SUBMISSION_TYPES[req.params.type];
  if (!spec) return res.status(404).json({ error: 'Unknown form' });

  const name = clean(req.body.name, 200);
  const email = clean(req.body.email, 200);
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' });
  if (!email.includes('@')) return res.status(400).json({ error: 'A valid email is required.' });

  const entry = { id: store.id(), date: nowIso(), status: 'new' };
  for (const f of spec.fields) entry[f] = clean(req.body[f]);
  db[spec.collection].unshift(entry);
  store.save();

  // Respond immediately; subscribe/sync in the background so a slow Brevo
  // request never delays the user-visible success message.
  const metadata = {};
  for (const f of spec.metaFields || []) {
    if (entry[f]) metadata[f.toUpperCase()] = entry[f];
  }
  syncSubscriber({
    email: entry.email.toLowerCase(),
    fullName: entry.name,
    phone: entry.phone,
    source: spec.source,
    metadata: Object.keys(metadata).length ? metadata : null
  });

  res.json({ ok: true });
});

app.post('/api/subscribe', (req, res) => {
  const email = clean(req.body.email, 200).toLowerCase();
  const fullName = clean(req.body.name || req.body.fullName || '', 200);
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid email is required.' });
  if (!db.newsletter.some(n => n.email === email)) {
    db.newsletter.unshift({ id: store.id(), email, fullName, date: nowIso() });
    store.save();
  }
  syncSubscriber({
    email,
    fullName: fullName || undefined,
    source: 'newsletter',
    metadata: null
  });
  res.json({ ok: true });
});

// ---- Brevo unsubscribe webhook ----
// Configure this URL in Brevo → Transactional/Marketing → Webhooks with the
// "unsubscribe" event. Include ?secret=<value> matching BREVO_WEBHOOK_SECRET
// so random posters can't flip subscribers off.
app.post('/api/webhooks/brevo', async (req, res) => {
  const secret = process.env.BREVO_WEBHOOK_SECRET || '';
  if (secret && req.query.secret !== secret) return res.status(401).json({ error: 'bad secret' });
  const body = req.body || {};
  const event = String(body.event || '').toLowerCase();
  const email = String(body.email || '').toLowerCase();
  if (!email) return res.status(400).json({ error: 'missing email' });
  // Handle unsubscribe + list_unsubscribe + spam events uniformly.
  if (event === 'unsubscribe' || event === 'list_unsubscribe' || event === 'spam') {
    try {
      const rows = await pg.markUnsubscribedByEmail(email);
      console.log('[brevo webhook] unsubscribed', email, 'sources:', rows.map(r => r.source).join(','));
    } catch (err) {
      console.error('[brevo webhook] failed to flip subscribed flag:', err && err.message);
    }
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
const SUBMISSION_COLLECTIONS = new Set(['members', 'volunteers', 'pledges', 'contacts', 'partners_enquiries', 'newsletter']);

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

// Brevo diagnostics — sanity-check the API key, sender, and configured lists.
// Read-only: makes lightweight calls to Brevo and reports what it sees. Useful
// when welcome emails aren't landing and you need to know whether the code, the
// config, or Brevo itself is the problem.
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
    apiKeyWorks: null,
    account: null,
    senderVerified: null,
    listChecks: {},
    error: null
  };
  if (!brevo.enabled()) {
    report.error = 'BREVO_API_KEY is not set.';
    return res.json(report);
  }
  try {
    // 1) Prove the API key works and grab account/plan info.
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
      email: accData.email,
      companyName: accData.companyName,
      plan: (accData.plan || []).map(p => ({ type: p.type, credits: p.credits, creditsType: p.creditsType }))
    };

    // 2) Is the configured sender verified?
    if (process.env.BREVO_SENDER_EMAIL) {
      const sr = await fetch('https://api.brevo.com/v3/senders', {
        headers: { 'api-key': process.env.BREVO_API_KEY, Accept: 'application/json' }
      });
      const sd = sr.ok ? await sr.json() : { senders: [] };
      const match = (sd.senders || []).find(s => (s.email || '').toLowerCase() === process.env.BREVO_SENDER_EMAIL.toLowerCase());
      report.senderVerified = match ? { active: !!match.active, name: match.name } : false;
    }

    // 3) Does each configured list actually exist?
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
    // Node's fetch (undici) wraps the actual reason in err.cause.
    // Surface both so "fetch failed" doesn't hide the DNS/TLS/TCP reason.
    report.error = err.message;
    report.errorCause = err.cause ? {
      message: err.cause.message,
      code: err.cause.code,
      errno: err.cause.errno,
      syscall: err.cause.syscall,
      hostname: err.cause.hostname
    } : null;
    report.nodeVersion = process.version;
    res.status(200).json(report);
  }
});

// Subscriber counts per source (drives dashboard overview + audience selector).
app.get('/api/admin/subscribers/counts', requireAdmin, async (req, res) => {
  if (!requirePg(res)) return;
  try {
    const counts = await pg.countsBySource();
    res.json({ ok: true, counts, brevoConfigured: brevo.enabled() });
  } catch (err) {
    console.error('[admin] counts failed:', err);
    res.status(500).json({ error: 'Failed to load subscriber counts.' });
  }
});

// List past + queued campaigns.
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

// Compose + send (or schedule). `action` is 'send', 'schedule', or 'test'.
app.post('/api/admin/campaigns', requireAdmin, async (req, res) => {
  if (!requirePg(res)) return;
  if (!brevo.enabled()) return res.status(503).json({ error: 'Brevo is not configured (missing BREVO_API_KEY).' });

  const subject = clean(req.body.subject, 500);
  const body = clean(req.body.body, 200000);
  const audienceRaw = Array.isArray(req.body.audience) ? req.body.audience : [];
  const audience = audienceRaw.map((s) => String(s || '').toLowerCase()).filter((s) => VALID_AUDIENCES.has(s));
  const action = String(req.body.action || 'send').toLowerCase();
  const scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;
  const testEmail = clean(req.body.testEmail, 200);

  if (!subject) return res.status(400).json({ error: 'Subject is required.' });
  if (!body) return res.status(400).json({ error: 'Body is required.' });
  if (!audience.length) return res.status(400).json({ error: 'Pick at least one audience.' });
  if (action === 'schedule' && (!scheduledAt || isNaN(scheduledAt.getTime()) || scheduledAt <= new Date())) {
    return res.status(400).json({ error: 'A future scheduled date/time is required.' });
  }
  if (action === 'test' && !testEmail) return res.status(400).json({ error: 'A test recipient email is required.' });

  // Wrap the composed HTML in a minimal frame and include Brevo's mandatory
  // unsubscribe link token so campaigns pass compliance.
  const htmlContent = wrapCampaignHtml(subject, body);

  let recipientCount = 0;
  try {
    const emails = await pg.activeEmailsForSources(audience);
    recipientCount = emails.length;
  } catch (err) {
    console.error('[admin] audience count failed:', err);
  }

  let campaignId = null;
  let record = null;
  try {
    record = await pg.createCampaignRecord({
      subject, audience,
      status: action === 'test' ? 'test' : (action === 'schedule' ? 'scheduled' : 'sending'),
      scheduledAt: action === 'schedule' ? scheduledAt.toISOString() : null,
      sentBy: req.session.adminUser,
      recipientCount
    });

    campaignId = await brevo.createCampaign({
      subject,
      htmlContent,
      audience,
      scheduledAt: action === 'schedule' ? scheduledAt : null
    });

    if (action === 'test') {
      await brevo.sendTestEmail(campaignId, testEmail);
      // Test doesn't count as a real send; keep the record for history but
      // mark it clearly.
      return res.json({ ok: true, action: 'test', brevoCampaignId: campaignId });
    }
    if (action === 'send') {
      await brevo.sendCampaignNow(campaignId);
      await pg.markCampaignSent(record.id, {
        sentAt: new Date().toISOString(),
        recipientCount,
        brevoCampaignId: campaignId
      });
      return res.json({ ok: true, action: 'send', brevoCampaignId: campaignId, recipientCount });
    }
    // schedule — Brevo already queued it via scheduledAt in createCampaign;
    // just update our local record.
    await pg.markCampaignScheduled(record.id, {
      scheduledAt: scheduledAt.toISOString(),
      recipientCount,
      brevoCampaignId: campaignId
    });
    return res.json({ ok: true, action: 'schedule', brevoCampaignId: campaignId, scheduledAt: scheduledAt.toISOString(), recipientCount });
  } catch (err) {
    console.error('[admin] campaign send failed:', err);
    if (record) {
      try { await pg.markCampaignFailed(record.id, err.message); } catch (_) { /* ignore */ }
    }
    return res.status(502).json({ error: err.message || 'Brevo request failed.' });
  }
});

function wrapCampaignHtml(subject, body) {
  const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // Very light wrapper — Brevo injects tracking + unsubscribe automatically
  // via the {{ unsubscribe }} token which the platform expands per-recipient.
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#222;max-width:640px;margin:0 auto;padding:24px">
<h1 style="color:#0042ab;font-size:22px;margin:0 0 16px">${esc(subject)}</h1>
<div style="font-size:15px;line-height:1.55">${body}</div>
<hr style="margin:32px 0;border:none;border-top:1px solid #ddd">
<p style="font-size:12px;color:#888">Rise With Pledge Foundation · <a href="{{ unsubscribe }}" style="color:#888">Unsubscribe</a></p>
</body></html>`;
}

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
