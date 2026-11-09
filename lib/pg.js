/**
 * Neon Postgres client + schema bootstrap.
 *
 * All durable state lives here on Vercel, because the JSON file store at
 * `data/db.json` runs in /tmp in serverless and gets wiped on cold start.
 * When DATABASE_URL is unset, `enabled()` returns false and callers fall
 * back to the JSON store — this keeps local dev working without Neon.
 */
const { neon } = require('@neondatabase/serverless');

const CONNECTION_STRING = process.env.DATABASE_URL || '';
let sql = null;
let bootstrapPromise = null;
let bootstrapDone = false;

const SOURCES = ['newsletter', 'volunteer', 'membership', 'pledge', 'partner', 'contact'];
const CONTENT_COLLECTIONS = ['team', 'projects', 'stories', 'news', 'gallery', 'reports', 'partners'];
const SUBMISSION_TYPES = ['member', 'volunteer', 'pledge', 'contact', 'partner'];

function enabled() {
  return !!CONNECTION_STRING;
}

function client() {
  if (!enabled()) throw new Error('DATABASE_URL is not configured');
  if (!sql) sql = neon(CONNECTION_STRING);
  return sql;
}

/**
 * Idempotent schema bootstrap. Called lazily before the first query so we
 * do not need a separate migration runner. Safe to call many times.
 */
async function bootstrap() {
  if (!enabled()) return;
  if (bootstrapDone) return;
  if (bootstrapPromise) return bootstrapPromise;
  const c = client();
  bootstrapPromise = (async () => {
    await c`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

    // --- subscribers (mailing-list view) ---
    await c`
      CREATE TABLE IF NOT EXISTS subscribers (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email             TEXT NOT NULL,
        full_name         TEXT,
        phone             TEXT,
        source            TEXT NOT NULL CHECK (source IN ('newsletter','volunteer','membership','pledge','partner','contact')),
        brevo_contact_id  TEXT,
        subscribed        BOOLEAN NOT NULL DEFAULT true,
        unsubscribe_token UUID NOT NULL DEFAULT gen_random_uuid(),
        metadata          JSONB,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (email, source)
      )
    `;
    await c`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS date_of_birth DATE`;
    await c`CREATE INDEX IF NOT EXISTS idx_subscribers_source_subscribed ON subscribers (source, subscribed)`;
    await c`CREATE INDEX IF NOT EXISTS idx_subscribers_email_lower ON subscribers (LOWER(email))`;
    await c`CREATE INDEX IF NOT EXISTS idx_subscribers_token ON subscribers (unsubscribe_token)`;
    await c`CREATE INDEX IF NOT EXISTS idx_subscribers_dob_mmdd ON subscribers (EXTRACT(MONTH FROM date_of_birth), EXTRACT(DAY FROM date_of_birth))`;

    // --- campaigns (admin email sends) ---
    await c`
      CREATE TABLE IF NOT EXISTS campaigns (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subject           TEXT NOT NULL,
        audience          TEXT[] NOT NULL,
        brevo_campaign_id TEXT,
        status            TEXT NOT NULL DEFAULT 'draft',
        scheduled_at      TIMESTAMPTZ,
        sent_by           TEXT,
        sent_at           TIMESTAMPTZ,
        recipient_count   INTEGER,
        error             TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await c`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS provider TEXT`;

    // --- content_items (team, projects, stories, news, gallery, reports, partners) ---
    // Polymorphic store keyed by `collection`; per-collection fields live in `data` JSONB.
    // `file_url` is a public Blob URL; `file_type` carries 'image' / 'video' / 'document'.
    await c`
      CREATE TABLE IF NOT EXISTS content_items (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        collection  TEXT NOT NULL CHECK (collection IN ('team','projects','stories','news','gallery','reports','partners')),
        data        JSONB NOT NULL DEFAULT '{}'::jsonb,
        file_url    TEXT,
        file_type   TEXT,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await c`CREATE INDEX IF NOT EXISTS idx_content_collection_order ON content_items (collection, sort_order, created_at DESC)`;

    // --- site_settings (key/value: 'settings', 'impact') ---
    await c`
      CREATE TABLE IF NOT EXISTS site_settings (
        key        TEXT PRIMARY KEY,
        value      JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    // --- admins (durable admin accounts, replaces db.admins on Vercel) ---
    await c`
      CREATE TABLE IF NOT EXISTS admins (
        username   TEXT PRIMARY KEY,
        salt       TEXT NOT NULL,
        hash       TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    // --- submissions (raw per-form detail; mailing-list view is in subscribers) ---
    await c`
      CREATE TABLE IF NOT EXISTS submissions (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type        TEXT NOT NULL CHECK (type IN ('member','volunteer','pledge','contact','partner','newsletter')),
        entry       JSONB NOT NULL,
        status      TEXT NOT NULL DEFAULT 'new',
        note        TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await c`CREATE INDEX IF NOT EXISTS idx_submissions_type_created ON submissions (type, created_at DESC)`;

    // --- birthday_messages (log of birthday automation sends) ---
    await c`
      CREATE TABLE IF NOT EXISTS birthday_messages (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subscriber_id UUID,
        email         TEXT NOT NULL,
        full_name     TEXT,
        sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        status        TEXT NOT NULL DEFAULT 'sent',
        provider_id   TEXT,
        error         TEXT
      )
    `;
    await c`CREATE INDEX IF NOT EXISTS idx_birthday_messages_sent_at ON birthday_messages (sent_at DESC)`;

    bootstrapDone = true;
  })().catch((err) => {
    bootstrapPromise = null;
    console.error('[pg] schema bootstrap failed:', err);
    throw err;
  });
  return bootstrapPromise;
}

// ============================================================
// SUBSCRIBERS
// ============================================================

async function upsertSubscriber({ email, fullName, phone, source, metadata, dateOfBirth }) {
  await bootstrap();
  const c = client();
  if (!SOURCES.includes(source)) throw new Error(`Unknown subscriber source: ${source}`);
  const dob = dateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) ? dateOfBirth : null;
  const rows = await c`
    INSERT INTO subscribers (email, full_name, phone, source, metadata, date_of_birth)
    VALUES (${email.toLowerCase()}, ${fullName || null}, ${phone || null}, ${source}, ${metadata || null}, ${dob})
    ON CONFLICT (email, source) DO UPDATE
      SET full_name     = COALESCE(EXCLUDED.full_name, subscribers.full_name),
          phone         = COALESCE(EXCLUDED.phone, subscribers.phone),
          metadata      = COALESCE(EXCLUDED.metadata, subscribers.metadata),
          date_of_birth = COALESCE(EXCLUDED.date_of_birth, subscribers.date_of_birth),
          subscribed    = true,
          updated_at    = now()
    RETURNING id, email, full_name, phone, source, subscribed, unsubscribe_token, date_of_birth,
              (xmax = 0) AS created
  `;
  const row = rows[0];
  return { row, created: !!row.created };
}

async function setBrevoContactId(id, brevoContactId) {
  await bootstrap();
  const c = client();
  await c`UPDATE subscribers SET brevo_contact_id = ${String(brevoContactId)} WHERE id = ${id}`;
}

async function markUnsubscribedByEmail(email) {
  await bootstrap();
  const c = client();
  const rows = await c`
    UPDATE subscribers
       SET subscribed = false, updated_at = now()
     WHERE LOWER(email) = ${String(email || '').toLowerCase()}
     RETURNING id, source
  `;
  return rows;
}

async function markUnsubscribedByToken(token) {
  await bootstrap();
  const c = client();
  const rows = await c`
    UPDATE subscribers
       SET subscribed = false, updated_at = now()
     WHERE unsubscribe_token = ${token}
     RETURNING id, email, source
  `;
  return rows;
}

async function countsBySource() {
  await bootstrap();
  const c = client();
  const rows = await c`
    SELECT source, COUNT(*) FILTER (WHERE subscribed) AS active,
                    COUNT(*) AS total
    FROM subscribers
    GROUP BY source
  `;
  const out = {};
  for (const s of SOURCES) out[s] = { active: 0, total: 0 };
  for (const r of rows) out[r.source] = { active: Number(r.active), total: Number(r.total) };
  return out;
}

async function activeSubscribersForSources(sources) {
  await bootstrap();
  const c = client();
  const clean = sources.filter((s) => SOURCES.includes(s));
  if (!clean.length) return [];
  // Dedupe by lower(email); keep first full_name + unsubscribe_token encountered.
  const rows = await c`
    SELECT DISTINCT ON (LOWER(email))
           LOWER(email) AS email, full_name, unsubscribe_token
      FROM subscribers
     WHERE subscribed = true AND source = ANY(${clean})
     ORDER BY LOWER(email), created_at
  `;
  return rows;
}

async function activeEmailsForSources(sources) {
  const rows = await activeSubscribersForSources(sources);
  return rows.map((r) => r.email);
}

// ============================================================
// CAMPAIGNS
// ============================================================

async function createCampaignRecord({ subject, audience, brevoCampaignId, status, scheduledAt, sentBy, recipientCount, provider }) {
  await bootstrap();
  const c = client();
  const rows = await c`
    INSERT INTO campaigns (subject, audience, brevo_campaign_id, status, scheduled_at, sent_by, recipient_count, provider)
    VALUES (${subject}, ${audience}, ${brevoCampaignId || null}, ${status || 'draft'},
            ${scheduledAt || null}, ${sentBy || null}, ${recipientCount || null}, ${provider || null})
    RETURNING *
  `;
  return rows[0];
}

async function markCampaignSent(id, { sentAt, recipientCount, brevoCampaignId }) {
  await bootstrap();
  const c = client();
  const rows = await c`
    UPDATE campaigns
       SET status = 'sent',
           sent_at = ${sentAt || new Date().toISOString()},
           recipient_count = COALESCE(${recipientCount || null}, recipient_count),
           brevo_campaign_id = COALESCE(${brevoCampaignId || null}, brevo_campaign_id)
     WHERE id = ${id}
     RETURNING *
  `;
  return rows[0];
}

async function markCampaignScheduled(id, { scheduledAt, recipientCount, brevoCampaignId }) {
  await bootstrap();
  const c = client();
  const rows = await c`
    UPDATE campaigns
       SET status = 'scheduled',
           scheduled_at = ${scheduledAt || null},
           recipient_count = COALESCE(${recipientCount || null}, recipient_count),
           brevo_campaign_id = COALESCE(${brevoCampaignId || null}, brevo_campaign_id)
     WHERE id = ${id}
     RETURNING *
  `;
  return rows[0];
}

async function markCampaignFailed(id, message) {
  await bootstrap();
  const c = client();
  await c`UPDATE campaigns SET status = 'failed', error = ${String(message || '').slice(0, 2000)} WHERE id = ${id}`;
}

async function listCampaigns(limit = 50) {
  await bootstrap();
  const c = client();
  const rows = await c`
    SELECT * FROM campaigns
    ORDER BY COALESCE(sent_at, created_at) DESC
    LIMIT ${Math.min(200, Math.max(1, Number(limit) || 50))}
  `;
  return rows;
}

// ============================================================
// CONTENT ITEMS
// ============================================================

async function listAllContent() {
  await bootstrap();
  const c = client();
  const rows = await c`
    SELECT id, collection, data, file_url, file_type, sort_order, created_at, updated_at
      FROM content_items
     ORDER BY collection, sort_order, created_at DESC
  `;
  return rows;
}

async function listContent(collection) {
  await bootstrap();
  const c = client();
  const rows = await c`
    SELECT id, collection, data, file_url, file_type, sort_order, created_at, updated_at
      FROM content_items
     WHERE collection = ${collection}
     ORDER BY sort_order, created_at DESC
  `;
  return rows;
}

async function insertContent({ collection, data, fileUrl, fileType }) {
  await bootstrap();
  const c = client();
  if (!CONTENT_COLLECTIONS.includes(collection)) throw new Error('Unknown collection: ' + collection);
  const rows = await c`
    INSERT INTO content_items (collection, data, file_url, file_type)
    VALUES (${collection}, ${data || {}}, ${fileUrl || null}, ${fileType || null})
    RETURNING *
  `;
  return rows[0];
}

async function updateContent({ id, collection, data, fileUrl, fileType }) {
  await bootstrap();
  const c = client();
  // Only overwrite file_url when a new one is provided; null means "keep the existing file".
  const rows = await c`
    UPDATE content_items
       SET data       = COALESCE(${data || null}, data),
           file_url   = COALESCE(${fileUrl || null}, file_url),
           file_type  = COALESCE(${fileType || null}, file_type),
           updated_at = now()
     WHERE id = ${id} AND collection = ${collection}
    RETURNING *
  `;
  return rows[0];
}

async function deleteContent({ id, collection }) {
  await bootstrap();
  const c = client();
  const rows = await c`
    DELETE FROM content_items WHERE id = ${id} AND collection = ${collection}
    RETURNING file_url
  `;
  return rows[0];
}

// ============================================================
// SITE SETTINGS (key/value)
// ============================================================

async function getSetting(key) {
  await bootstrap();
  const c = client();
  const rows = await c`SELECT value FROM site_settings WHERE key = ${key}`;
  return rows[0] ? rows[0].value : null;
}

async function setSetting(key, value) {
  await bootstrap();
  const c = client();
  const rows = await c`
    INSERT INTO site_settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    RETURNING *
  `;
  return rows[0];
}

// ============================================================
// ADMINS
// ============================================================

async function listAdmins() {
  await bootstrap();
  const c = client();
  return c`SELECT username, salt, hash, created_at FROM admins`;
}

async function findAdmin(username) {
  await bootstrap();
  const c = client();
  const rows = await c`SELECT username, salt, hash FROM admins WHERE username = ${String(username || '').toLowerCase()}`;
  return rows[0] || null;
}

async function upsertAdmin({ username, salt, hash }) {
  await bootstrap();
  const c = client();
  const rows = await c`
    INSERT INTO admins (username, salt, hash) VALUES (${username.toLowerCase()}, ${salt}, ${hash})
    ON CONFLICT (username) DO UPDATE SET salt = EXCLUDED.salt, hash = EXCLUDED.hash, updated_at = now()
    RETURNING username
  `;
  return rows[0];
}

async function updateAdminPassword(username, salt, hash) {
  await bootstrap();
  const c = client();
  await c`UPDATE admins SET salt = ${salt}, hash = ${hash}, updated_at = now() WHERE username = ${username.toLowerCase()}`;
}

// ============================================================
// SUBMISSIONS (raw per-form detail for admin review)
// ============================================================

async function insertSubmission({ type, entry }) {
  await bootstrap();
  const c = client();
  const rows = await c`
    INSERT INTO submissions (type, entry) VALUES (${type}, ${entry})
    RETURNING *
  `;
  return rows[0];
}

async function listSubmissions(type) {
  await bootstrap();
  const c = client();
  if (type) {
    return c`SELECT * FROM submissions WHERE type = ${type} ORDER BY created_at DESC`;
  }
  return c`SELECT * FROM submissions ORDER BY created_at DESC`;
}

async function updateSubmission(id, patch) {
  await bootstrap();
  const c = client();
  const rows = await c`
    UPDATE submissions
       SET status = COALESCE(${patch.status || null}, status),
           note   = COALESCE(${patch.note   || null}, note)
     WHERE id = ${id}
     RETURNING *
  `;
  return rows[0];
}

async function deleteSubmission(id) {
  await bootstrap();
  const c = client();
  await c`DELETE FROM submissions WHERE id = ${id}`;
}

// ============================================================
// BIRTHDAYS
// ============================================================

async function findMembersWithBirthdayToday() {
  await bootstrap();
  const c = client();
  return c`
    SELECT id, email, full_name, date_of_birth, unsubscribe_token
      FROM subscribers
     WHERE subscribed = true
       AND date_of_birth IS NOT NULL
       AND EXTRACT(MONTH FROM date_of_birth) = EXTRACT(MONTH FROM CURRENT_DATE)
       AND EXTRACT(DAY   FROM date_of_birth) = EXTRACT(DAY   FROM CURRENT_DATE)
       AND source = 'membership'
  `;
}

async function findUpcomingBirthdays(days = 14) {
  await bootstrap();
  const c = client();
  // Postgres doesn't do month/day intervals cleanly; compute next-occurrence
  // in the current year and the next, keep whichever is >= today.
  return c`
    WITH upcoming AS (
      SELECT id, email, full_name, date_of_birth,
             LEAST(
               (date_trunc('year', CURRENT_DATE) + (date_of_birth - date_trunc('year', date_of_birth)))::date,
               (date_trunc('year', CURRENT_DATE + INTERVAL '1 year') + (date_of_birth - date_trunc('year', date_of_birth)))::date
             ) AS this_year,
             (date_trunc('year', CURRENT_DATE + INTERVAL '1 year') + (date_of_birth - date_trunc('year', date_of_birth)))::date AS next_year
        FROM subscribers
       WHERE subscribed = true AND date_of_birth IS NOT NULL AND source = 'membership'
    )
    SELECT id, email, full_name, date_of_birth,
           CASE WHEN this_year >= CURRENT_DATE THEN this_year ELSE next_year END AS next_birthday
      FROM upcoming
     WHERE (CASE WHEN this_year >= CURRENT_DATE THEN this_year ELSE next_year END)
           BETWEEN CURRENT_DATE AND (CURRENT_DATE + (${Number(days) || 14} || ' days')::interval)
     ORDER BY next_birthday
  `;
}

async function logBirthdayMessage({ subscriberId, email, fullName, status, providerId, error }) {
  await bootstrap();
  const c = client();
  const rows = await c`
    INSERT INTO birthday_messages (subscriber_id, email, full_name, status, provider_id, error)
    VALUES (${subscriberId || null}, ${email}, ${fullName || null}, ${status || 'sent'},
            ${providerId || null}, ${error ? String(error).slice(0, 2000) : null})
    RETURNING *
  `;
  return rows[0];
}

async function listBirthdayMessages(limit = 100) {
  await bootstrap();
  const c = client();
  return c`
    SELECT * FROM birthday_messages
    ORDER BY sent_at DESC
    LIMIT ${Math.min(500, Math.max(1, Number(limit) || 100))}
  `;
}

async function wasBirthdayMessageSentToday(subscriberId) {
  await bootstrap();
  const c = client();
  const rows = await c`
    SELECT 1 FROM birthday_messages
     WHERE subscriber_id = ${subscriberId}
       AND sent_at::date = CURRENT_DATE
     LIMIT 1
  `;
  return rows.length > 0;
}

module.exports = {
  SOURCES,
  CONTENT_COLLECTIONS,
  SUBMISSION_TYPES,
  enabled,
  bootstrap,
  // subscribers
  upsertSubscriber,
  setBrevoContactId,
  markUnsubscribedByEmail,
  markUnsubscribedByToken,
  countsBySource,
  activeSubscribersForSources,
  activeEmailsForSources,
  // campaigns
  createCampaignRecord,
  markCampaignSent,
  markCampaignScheduled,
  markCampaignFailed,
  listCampaigns,
  // content
  listAllContent,
  listContent,
  insertContent,
  updateContent,
  deleteContent,
  // settings
  getSetting,
  setSetting,
  // admins
  listAdmins,
  findAdmin,
  upsertAdmin,
  updateAdminPassword,
  // submissions
  insertSubmission,
  listSubmissions,
  updateSubmission,
  deleteSubmission,
  // birthdays
  findMembersWithBirthdayToday,
  findUpcomingBirthdays,
  logBirthdayMessage,
  listBirthdayMessages,
  wasBirthdayMessageSentToday
};
