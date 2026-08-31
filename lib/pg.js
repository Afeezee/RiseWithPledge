/**
 * Neon Postgres client + schema bootstrap.
 *
 * The subscribers + campaigns tables live in Neon rather than data/db.json
 * because on Vercel the JSON store lives in /tmp and is ephemeral — signup
 * data would be lost across cold starts. The rest of the site (content,
 * admin accounts, existing submission collections) still uses the JSON store
 * for backwards compatibility with the admin dashboard.
 *
 * Requires DATABASE_URL (Neon connection string). If DATABASE_URL is not set,
 * `enabled()` returns false and callers should skip the sync silently — this
 * keeps local development working before Neon is provisioned.
 */
const { neon } = require('@neondatabase/serverless');

const CONNECTION_STRING = process.env.DATABASE_URL || '';
let sql = null;
let bootstrapPromise = null;
let bootstrapDone = false;

const SOURCES = ['newsletter', 'volunteer', 'membership', 'pledge', 'partner', 'contact'];

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
 * do not need a separate migration runner.
 */
async function bootstrap() {
  if (!enabled()) return;
  if (bootstrapDone) return;
  if (bootstrapPromise) return bootstrapPromise;
  const c = client();
  bootstrapPromise = (async () => {
    // gen_random_uuid() lives in pgcrypto on older Postgres; on Neon it is
    // available as-is in pg 13+ via pgcrypto extension. Guard just in case.
    await c`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

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
    await c`CREATE INDEX IF NOT EXISTS idx_subscribers_source_subscribed ON subscribers (source, subscribed)`;
    await c`CREATE INDEX IF NOT EXISTS idx_subscribers_email_lower ON subscribers (LOWER(email))`;

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

    bootstrapDone = true;
  })().catch((err) => {
    // Reset so a later request can retry, and surface the error.
    bootstrapPromise = null;
    console.error('[pg] schema bootstrap failed:', err);
    throw err;
  });
  return bootstrapPromise;
}

/**
 * Upsert a subscriber. Returns { row, created } where created=true means
 * this was a new (email, source) pair.
 */
async function upsertSubscriber({ email, fullName, phone, source, metadata }) {
  await bootstrap();
  const c = client();
  if (!SOURCES.includes(source)) throw new Error(`Unknown subscriber source: ${source}`);
  const rows = await c`
    INSERT INTO subscribers (email, full_name, phone, source, metadata)
    VALUES (${email.toLowerCase()}, ${fullName || null}, ${phone || null}, ${source}, ${metadata || null})
    ON CONFLICT (email, source) DO UPDATE
      SET full_name  = COALESCE(EXCLUDED.full_name, subscribers.full_name),
          phone      = COALESCE(EXCLUDED.phone, subscribers.phone),
          metadata   = COALESCE(EXCLUDED.metadata, subscribers.metadata),
          subscribed = true,
          updated_at = now()
    RETURNING id, email, full_name, phone, source, subscribed, unsubscribe_token,
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

async function activeEmailsForSources(sources) {
  await bootstrap();
  const c = client();
  const clean = sources.filter((s) => SOURCES.includes(s));
  if (!clean.length) return [];
  const rows = await c`
    SELECT DISTINCT LOWER(email) AS email
      FROM subscribers
     WHERE subscribed = true AND source = ANY(${clean})
  `;
  return rows.map((r) => r.email);
}

async function createCampaignRecord({ subject, audience, brevoCampaignId, status, scheduledAt, sentBy, recipientCount }) {
  await bootstrap();
  const c = client();
  const rows = await c`
    INSERT INTO campaigns (subject, audience, brevo_campaign_id, status, scheduled_at, sent_by, recipient_count)
    VALUES (${subject}, ${audience}, ${brevoCampaignId || null}, ${status || 'draft'},
            ${scheduledAt || null}, ${sentBy || null}, ${recipientCount || null})
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

module.exports = {
  SOURCES,
  enabled,
  bootstrap,
  upsertSubscriber,
  setBrevoContactId,
  markUnsubscribedByEmail,
  countsBySource,
  activeEmailsForSources,
  createCampaignRecord,
  markCampaignSent,
  markCampaignScheduled,
  markCampaignFailed,
  listCampaigns
};
