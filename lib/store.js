/**
 * Unified data store.
 *
 * When DATABASE_URL is set (i.e. Vercel or any production environment),
 * all reads and writes go through Neon Postgres via lib/pg.js. Otherwise
 * we fall back to the historic JSON file store at data/db.json via
 * lib/db.js. This keeps local dev friction-free while making Vercel
 * actually durable.
 *
 * Every function is async so the two backends share a signature.
 *
 * Important: `collection` and `type` names are kept as they existed in
 * the JSON store so the admin UI needs no renaming. The mapping to
 * Postgres is:
 *   JSON key        PG table         PG filter
 *   ----------------------------------------------------------
 *   team            content_items    collection='team'
 *   projects        content_items    collection='projects'
 *   stories         content_items    collection='stories'
 *   news            content_items    collection='news'
 *   gallery         content_items    collection='gallery'
 *   reports         content_items    collection='reports'
 *   partners        content_items    collection='partners'
 *   settings        site_settings    key='settings'
 *   impact          site_settings    key='impact'
 *   admins          admins           -
 *   members         submissions      type='member'
 *   volunteers      submissions      type='volunteer'
 *   pledges         submissions      type='pledge'
 *   contacts        submissions      type='contact'
 *   partners_enquiries submissions   type='partner'
 *   newsletter      submissions      type='newsletter'
 *                      (plus durable row in subscribers via lib/pg)
 */
const pg = require('./pg');
const jsonStore = require('./db');

const CONTENT_COLLECTIONS = ['team', 'projects', 'stories', 'news', 'gallery', 'reports', 'partners'];
const SUBMISSION_TO_PG_TYPE = {
  members:            'member',
  volunteers:         'volunteer',
  pledges:            'pledge',
  contacts:           'contact',
  partners_enquiries: 'partner',
  newsletter:         'newsletter'
};
const PG_TYPE_TO_JSON = Object.fromEntries(Object.entries(SUBMISSION_TO_PG_TYPE).map(([k, v]) => [v, k]));

// Shape a content_items row to look like the JSON store's entry shape, so the
// admin UI (which reads { id, title, file, ...per-collection fields }) works
// unchanged.
function pgContentToClient(row) {
  const flat = { id: row.id, ...(row.data || {}), createdAt: row.created_at };
  if (row.file_url) flat.file = row.file_url;
  if (row.file_type) flat.fileType = row.file_type;
  return flat;
}

// Shape a submission row to the admin UI shape.
function pgSubmissionToClient(row) {
  return {
    id: row.id,
    date: row.created_at,
    status: row.status,
    note: row.note || undefined,
    ...(row.entry || {})
  };
}

// ============================================================
// CONTENT (team, projects, stories, news, gallery, reports, partners)
// ============================================================

/**
 * Return all content collections keyed by name. Used by GET /api/content.
 */
async function getPublicContent() {
  const db = jsonStore.get();
  if (pg.enabled()) {
    const rows = await pg.listAllContent();
    const out = {};
    for (const col of CONTENT_COLLECTIONS) out[col] = [];
    for (const r of rows) {
      (out[r.collection] = out[r.collection] || []).push(pgContentToClient(r));
    }
    // settings + impact — merge over defaults so new fields (e.g. customEmail)
    // appear even when the PG row was saved before the field existed.
    const pgSettings = await pg.getSetting('settings');
    const pgImpact   = await pg.getSetting('impact');
    out.settings = Object.assign({}, db.settings, pgSettings || {});
    out.impact   = Object.assign({}, db.impact,   pgImpact   || {});
    return out;
  }
  return {
    settings: db.settings,
    impact: db.impact,
    team: db.team,
    projects: db.projects,
    stories: db.stories,
    news: db.news,
    gallery: db.gallery,
    reports: db.reports,
    partners: db.partners
  };
}

async function getAllContentForAdmin() {
  const db = jsonStore.get();
  const base = {
    settings: db.settings, impact: db.impact,
    team: [], projects: [], stories: [], news: [], gallery: [], reports: [], partners: [],
    members: [], volunteers: [], pledges: [], contacts: [], partners_enquiries: [], newsletter: []
  };
  if (!pg.enabled()) {
    for (const col of CONTENT_COLLECTIONS) base[col] = db[col] || [];
    base.members            = db.members || [];
    base.volunteers         = db.volunteers || [];
    base.pledges            = db.pledges || [];
    base.contacts           = db.contacts || [];
    base.partners_enquiries = db.partners_enquiries || [];
    base.newsletter         = db.newsletter || [];
    return base;
  }

  const [content, subs, settings, impact] = await Promise.all([
    pg.listAllContent(),
    pg.listSubmissions(),
    pg.getSetting('settings'),
    pg.getSetting('impact')
  ]);
  base.settings = Object.assign({}, db.settings, settings || {});
  base.impact   = Object.assign({}, db.impact,   impact   || {});
  for (const r of content) {
    (base[r.collection] = base[r.collection] || []).push(pgContentToClient(r));
  }
  for (const r of subs) {
    const jsonKey = PG_TYPE_TO_JSON[r.type];
    if (!jsonKey) continue;
    (base[jsonKey] = base[jsonKey] || []).push(pgSubmissionToClient(r));
  }
  return base;
}

async function insertContent(collection, data, file) {
  if (!CONTENT_COLLECTIONS.includes(collection)) throw new Error('Unknown collection: ' + collection);
  if (pg.enabled()) {
    const row = await pg.insertContent({
      collection,
      data,
      fileUrl: file ? file.url : null,
      fileType: file ? file.type : null
    });
    return pgContentToClient(row);
  }
  const db = jsonStore.get();
  const entry = { id: jsonStore.id(), createdAt: new Date().toISOString(), ...data };
  if (file && file.url) entry.file = file.url;
  if (file && file.type) entry.fileType = file.type;
  db[collection].unshift(entry);
  jsonStore.save();
  return entry;
}

async function updateContent(collection, id, patch, file) {
  if (!CONTENT_COLLECTIONS.includes(collection)) throw new Error('Unknown collection: ' + collection);
  if (pg.enabled()) {
    const row = await pg.updateContent({
      id,
      collection,
      data: patch,
      fileUrl: file ? file.url : null,
      fileType: file ? file.type : null
    });
    return row ? pgContentToClient(row) : null;
  }
  const db = jsonStore.get();
  const item = (db[collection] || []).find(x => x.id === id);
  if (!item) return null;
  Object.assign(item, patch);
  if (file && file.url) item.file = file.url;
  if (file && file.type) item.fileType = file.type;
  jsonStore.save();
  return item;
}

async function deleteContent(collection, id) {
  if (!CONTENT_COLLECTIONS.includes(collection)) throw new Error('Unknown collection: ' + collection);
  if (pg.enabled()) {
    const row = await pg.deleteContent({ id, collection });
    return row ? { fileUrl: row.file_url } : null;
  }
  const db = jsonStore.get();
  const arr = db[collection] || [];
  const idx = arr.findIndex(x => x.id === id);
  if (idx === -1) return null;
  const fileUrl = arr[idx].file || null;
  arr.splice(idx, 1);
  jsonStore.save();
  return { fileUrl };
}

// ============================================================
// SETTINGS + IMPACT
// ============================================================

async function patchSettings(patch, keysWhitelist) {
  const db = jsonStore.get();
  if (pg.enabled()) {
    // Start from PG value, else JSON defaults.
    const current = (await pg.getSetting('settings')) || db.settings || {};
    for (const key of keysWhitelist) {
      if (patch[key] !== undefined) current[key] = patch[key];
    }
    await pg.setSetting('settings', current);
    // Keep JSON in sync too so local dev reflects production state when both are set.
    db.settings = current;
    jsonStore.save();
    return current;
  }
  for (const key of keysWhitelist) {
    if (patch[key] !== undefined) db.settings[key] = patch[key];
  }
  jsonStore.save();
  return db.settings;
}

async function patchImpact(patch, keysWhitelist) {
  const db = jsonStore.get();
  if (pg.enabled()) {
    const current = (await pg.getSetting('impact')) || db.impact || {};
    for (const key of keysWhitelist) {
      if (patch[key] !== undefined) {
        const n = Number(patch[key]);
        current[key] = Number.isFinite(n) && n >= 0 ? n : 0;
      }
    }
    await pg.setSetting('impact', current);
    db.impact = current;
    jsonStore.save();
    return current;
  }
  for (const key of keysWhitelist) {
    if (patch[key] !== undefined) {
      const n = Number(patch[key]);
      db.impact[key] = Number.isFinite(n) && n >= 0 ? n : 0;
    }
  }
  jsonStore.save();
  return db.impact;
}

// ============================================================
// ADMINS
// ============================================================

async function findAdmin(username) {
  if (pg.enabled()) {
    const row = await pg.findAdmin(username);
    if (row) return row;
    // Fall back to JSON store if admin only exists there (e.g. just-seeded local).
  }
  const db = jsonStore.get();
  return (db.admins || []).find(a => a.username === String(username || '').toLowerCase()) || null;
}

async function updateAdminPassword(username, salt, hash) {
  if (pg.enabled()) {
    await pg.updateAdminPassword(username, salt, hash);
  }
  const db = jsonStore.get();
  const admin = (db.admins || []).find(a => a.username === username);
  if (admin) {
    admin.salt = salt;
    admin.hash = hash;
    jsonStore.save();
  }
}

/**
 * Seed admins into PG from the JSON store on first PG-enabled boot.
 * Idempotent: only inserts usernames that are not already in PG.
 */
async function syncAdminsToPg() {
  if (!pg.enabled()) return;
  const db = jsonStore.get();
  if (!Array.isArray(db.admins) || !db.admins.length) return;
  for (const a of db.admins) {
    try {
      const existing = await pg.findAdmin(a.username);
      if (!existing) await pg.upsertAdmin({ username: a.username, salt: a.salt, hash: a.hash });
    } catch (err) {
      console.warn('[store] admin sync failed for', a.username, err && err.message);
    }
  }
}

// ============================================================
// SUBMISSIONS (member/volunteer/pledge/contact/partner/newsletter)
// ============================================================

async function insertSubmission(collection, entry) {
  const pgType = SUBMISSION_TO_PG_TYPE[collection];
  if (!pgType) throw new Error('Unknown submission collection: ' + collection);
  if (pg.enabled()) {
    const row = await pg.insertSubmission({ type: pgType, entry });
    return pgSubmissionToClient(row);
  }
  const db = jsonStore.get();
  const copy = { id: jsonStore.id(), date: new Date().toISOString(), status: 'new', ...entry };
  if (!Array.isArray(db[collection])) db[collection] = [];
  db[collection].unshift(copy);
  jsonStore.save();
  return copy;
}

async function updateSubmission(collection, id, patch) {
  const pgType = SUBMISSION_TO_PG_TYPE[collection];
  if (!pgType) return null;
  if (pg.enabled()) {
    const row = await pg.updateSubmission(id, patch);
    return row ? pgSubmissionToClient(row) : null;
  }
  const db = jsonStore.get();
  const item = (db[collection] || []).find(x => x.id === id);
  if (!item) return null;
  if (patch.status !== undefined) item.status = patch.status;
  if (patch.note !== undefined)   item.note   = patch.note;
  jsonStore.save();
  return item;
}

async function deleteSubmission(collection, id) {
  const pgType = SUBMISSION_TO_PG_TYPE[collection];
  if (!pgType) return false;
  if (pg.enabled()) {
    await pg.deleteSubmission(id);
    return true;
  }
  const db = jsonStore.get();
  const arr = db[collection] || [];
  const idx = arr.findIndex(x => x.id === id);
  if (idx === -1) return false;
  arr.splice(idx, 1);
  jsonStore.save();
  return true;
}

module.exports = {
  CONTENT_COLLECTIONS,
  SUBMISSION_TO_PG_TYPE,
  getPublicContent,
  getAllContentForAdmin,
  insertContent,
  updateContent,
  deleteContent,
  patchSettings,
  patchImpact,
  findAdmin,
  updateAdminPassword,
  syncAdminsToPg,
  insertSubmission,
  updateSubmission,
  deleteSubmission
};
