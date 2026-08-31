/**
 * Brevo (formerly Sendinblue) integration.
 *
 * Assumes the six contact lists and their per-list welcome automations
 * already exist in the Brevo dashboard. That setup is manual — see README.
 *
 * All calls are best-effort and never made from the browser. Callers should
 * wrap `upsertContact` in try/catch so a Brevo outage cannot break a public
 * form submission.
 */
const BREVO_API = 'https://api.brevo.com/v3';
const API_KEY = process.env.BREVO_API_KEY || '';
const SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Rise With Pledge Foundation';
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || '';
const REPLY_TO = process.env.BREVO_REPLY_TO || SENDER_EMAIL;

const LIST_IDS = {
  newsletter: numeric(process.env.BREVO_LIST_NEWSLETTER),
  volunteer:  numeric(process.env.BREVO_LIST_VOLUNTEER),
  membership: numeric(process.env.BREVO_LIST_MEMBERSHIP),
  pledge:     numeric(process.env.BREVO_LIST_PLEDGE),
  partner:    numeric(process.env.BREVO_LIST_PARTNER),
  contact:    numeric(process.env.BREVO_LIST_CONTACT)
};

function numeric(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function enabled() {
  return !!API_KEY;
}

function listId(source) {
  return LIST_IDS[source] || null;
}

function listIdsForSources(sources) {
  const ids = [];
  for (const s of sources) {
    const id = listId(s);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

async function call(path, { method = 'GET', body } = {}) {
  if (!enabled()) throw new Error('BREVO_API_KEY is not configured');
  const res = await fetch(BREVO_API + path, {
    method,
    headers: {
      'api-key': API_KEY,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Brevo ${method} ${path} failed (${res.status}): ${text}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * Create or update a contact and add them to the list for `source`.
 * Returns the Brevo contact id when available.
 */
async function upsertContact({ email, fullName, source, attributes }) {
  const list = listId(source);
  const payload = {
    email: String(email || '').toLowerCase(),
    attributes: {
      FIRSTNAME: fullName || undefined,
      SOURCE: source,
      ...(attributes || {})
    },
    updateEnabled: true
  };
  if (list) payload.listIds = [list];

  const data = await call('/contacts', { method: 'POST', body: payload });
  return data && data.id ? String(data.id) : null;
}

/**
 * Create a classic email campaign in Brevo and return its id.
 * We do NOT set a sender inline unless BREVO_SENDER_EMAIL is configured,
 * because Brevo requires the sender to be a verified sender in the account.
 */
async function createCampaign({ subject, htmlContent, audience, scheduledAt }) {
  const listIds = listIdsForSources(audience);
  if (!listIds.length) throw new Error('No Brevo lists match the selected audience');
  if (!SENDER_EMAIL) throw new Error('BREVO_SENDER_EMAIL is not configured');

  const body = {
    name: subject.slice(0, 200) + ' (' + new Date().toISOString() + ')',
    subject: subject,
    sender: { name: SENDER_NAME, email: SENDER_EMAIL },
    replyTo: REPLY_TO || SENDER_EMAIL,
    htmlContent: htmlContent,
    recipients: { listIds },
    inlineImageActivation: false
  };
  if (scheduledAt) body.scheduledAt = new Date(scheduledAt).toISOString();
  const data = await call('/emailCampaigns', { method: 'POST', body });
  return data && data.id ? String(data.id) : null;
}

async function sendCampaignNow(campaignId) {
  await call(`/emailCampaigns/${campaignId}/sendNow`, { method: 'POST' });
}

async function sendTestEmail(campaignId, emails) {
  const emailTo = (Array.isArray(emails) ? emails : [emails]).filter(Boolean);
  if (!emailTo.length) throw new Error('No test recipients provided');
  await call(`/emailCampaigns/${campaignId}/sendTest`, {
    method: 'POST',
    body: { emailTo }
  });
}

async function getCampaign(campaignId) {
  return call(`/emailCampaigns/${campaignId}`);
}

module.exports = {
  enabled,
  listId,
  listIdsForSources,
  upsertContact,
  createCampaign,
  sendCampaignNow,
  sendTestEmail,
  getCampaign
};
