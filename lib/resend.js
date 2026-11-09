/**
 * Resend REST client (no SDK — same `fetch` pattern used by lib/brevo.js).
 *
 * Resend is the primary email provider: welcome mails, birthday greetings,
 * and admin campaigns all go through it. The `sendBatch` path handles up
 * to 100 messages per API call, which keeps campaigns inside free-tier
 * rate limits.
 */
const RESEND_API = 'https://api.resend.com';
const API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@risewithpledge.org';
const FROM_NAME  = process.env.RESEND_FROM_NAME  || 'Rise With Pledge Foundation';
const REPLY_TO   = process.env.RESEND_REPLY_TO   || null;

function enabled() { return !!API_KEY; }

function fromHeader() {
  return `${FROM_NAME} <${FROM_EMAIL}>`;
}

async function call(path, { method = 'GET', body } = {}) {
  if (!enabled()) throw new Error('RESEND_API_KEY is not configured');
  const res = await fetch(RESEND_API + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + API_KEY,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Resend ${method} ${path} failed (${res.status}): ${text}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * Send one transactional email.
 * @returns {Promise<{id:string}>}
 */
async function sendEmail({ to, subject, html, text, from, replyTo, headers, tags }) {
  const body = {
    from: from || fromHeader(),
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text: text || undefined,
    reply_to: replyTo || REPLY_TO || undefined,
    headers: headers || undefined,
    tags: tags || undefined
  };
  return call('/emails', { method: 'POST', body });
}

/**
 * Send up to 100 emails in one request. Each entry is a { to, subject, html }.
 * @returns {Promise<{data:Array<{id:string}>}>}
 */
async function sendBatch(messages) {
  if (!Array.isArray(messages) || !messages.length) return { data: [] };
  const payload = messages.slice(0, 100).map(m => ({
    from: m.from || fromHeader(),
    to: Array.isArray(m.to) ? m.to : [m.to],
    subject: m.subject,
    html: m.html,
    text: m.text || undefined,
    reply_to: m.replyTo || REPLY_TO || undefined,
    headers: m.headers || undefined,
    tags: m.tags || undefined
  }));
  return call('/emails/batch', { method: 'POST', body: payload });
}

async function listDomains() {
  return call('/domains', { method: 'GET' });
}

module.exports = {
  enabled,
  fromHeader,
  sendEmail,
  sendBatch,
  listDomains,
  // exposed for diagnostics
  FROM_EMAIL,
  FROM_NAME
};
