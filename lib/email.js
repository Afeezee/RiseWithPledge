/**
 * Email provider abstraction.
 *
 * Primary provider is Resend (programmatic). Brevo is retained as a fallback
 * so an outage or account issue on one side can be hot-swapped by flipping
 * EMAIL_PROVIDER=brevo in env.
 *
 * All outbound mail passes through here so the rest of the app never calls
 * a specific provider's SDK directly.
 */
const resend = require('./resend');
const brevo = require('./brevo');
const templates = require('./email-templates');

const SITE_URL = process.env.SITE_URL || 'https://risewithpledge.org';

function providerName() {
  const p = String(process.env.EMAIL_PROVIDER || 'resend').toLowerCase();
  if (p === 'brevo' && brevo.enabled()) return 'brevo';
  if (p === 'resend' && resend.enabled()) return 'resend';
  // Fall back whichever is enabled, Resend preferred.
  if (resend.enabled()) return 'resend';
  if (brevo.enabled()) return 'brevo';
  return 'none';
}

function enabled() { return providerName() !== 'none'; }

function unsubscribeUrl(token) {
  return token ? `${SITE_URL.replace(/\/$/, '')}/unsubscribe/${token}` : null;
}

async function sendWelcome(source, { email, fullName, unsubscribeToken }) {
  if (!email) throw new Error('welcome: email is required');
  const msg = templates.welcome(source, {
    fullName,
    unsubscribeUrl: unsubscribeUrl(unsubscribeToken)
  });
  return _send({ to: email, ...msg, tags: [{ name: 'type', value: 'welcome' }, { name: 'source', value: source }] });
}

async function sendBirthday({ email, fullName, unsubscribeToken }) {
  if (!email) throw new Error('birthday: email is required');
  const msg = templates.birthday({ fullName, unsubscribeUrl: unsubscribeUrl(unsubscribeToken) });
  return _send({ to: email, ...msg, tags: [{ name: 'type', value: 'birthday' }] });
}

async function sendBirthdayDigest({ to, sent, failed, skipped }) {
  if (!to) throw new Error('birthday digest: recipient required');
  const msg = templates.birthdayDigest({ sent, failed, skipped });
  return _send({ to, ...msg, tags: [{ name: 'type', value: 'birthday-digest' }] });
}

/**
 * Send a campaign to many recipients. `recipients` is an array of
 * { email, full_name, unsubscribe_token }. Chunks into batches of 100
 * for Resend; for Brevo falls back to the classic campaign API.
 */
async function sendCampaign({ subject, html, recipients, campaignId }) {
  if (!Array.isArray(recipients) || !recipients.length) {
    throw new Error('sendCampaign: no recipients');
  }
  const provider = providerName();
  if (provider === 'brevo') {
    return _sendCampaignBrevo({ subject, html, recipients, campaignId });
  }
  // Resend path: personalized per-recipient (unique unsubscribe link).
  const out = { sent: 0, failed: 0, provider: 'resend', errors: [] };
  // Chunk into batches of 100 as Resend's batch endpoint allows.
  const chunkSize = 100;
  for (let i = 0; i < recipients.length; i += chunkSize) {
    const chunk = recipients.slice(i, i + chunkSize);
    const messages = chunk.map(r => {
      const built = templates.campaign(subject, html, unsubscribeUrl(r.unsubscribe_token));
      return {
        to: r.email,
        subject: built.subject,
        html: built.html,
        text: built.text,
        tags: [{ name: 'type', value: 'campaign' }, ...(campaignId ? [{ name: 'campaign', value: String(campaignId) }] : [])]
      };
    });
    try {
      const result = await resend.sendBatch(messages);
      out.sent += (result && result.data ? result.data.length : chunk.length);
    } catch (err) {
      out.failed += chunk.length;
      out.errors.push(err.message);
      console.error('[campaign] Resend batch failed:', err.message);
    }
  }
  return out;
}

async function _sendCampaignBrevo({ subject, html, recipients, campaignId }) {
  // We don't want to require the full list-based Brevo flow when the caller
  // has already resolved recipients from Postgres. Send one-by-one through
  // the Brevo transactional endpoint instead.
  const out = { sent: 0, failed: 0, provider: 'brevo', errors: [] };
  const fromEmail = process.env.BREVO_SENDER_EMAIL;
  const fromName  = process.env.BREVO_SENDER_NAME || 'Rise With Pledge Foundation';
  if (!fromEmail) throw new Error('BREVO_SENDER_EMAIL is required for campaign sends');
  for (const r of recipients) {
    const built = templates.campaign(subject, html, unsubscribeUrl(r.unsubscribe_token));
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: fromName, email: fromEmail },
          to: [{ email: r.email, name: r.full_name || undefined }],
          subject: built.subject,
          htmlContent: built.html,
          textContent: built.text,
          tags: ['campaign', ...(campaignId ? ['campaign:' + campaignId] : [])]
        })
      });
      if (res.ok) out.sent++;
      else { out.failed++; out.errors.push(await res.text()); }
    } catch (err) {
      out.failed++;
      out.errors.push(err.message);
    }
  }
  return out;
}

async function _send({ to, subject, html, text, tags }) {
  const provider = providerName();
  if (provider === 'resend') {
    return resend.sendEmail({ to, subject, html, text, tags });
  }
  if (provider === 'brevo') {
    const fromEmail = process.env.BREVO_SENDER_EMAIL;
    const fromName  = process.env.BREVO_SENDER_NAME || 'Rise With Pledge Foundation';
    if (!fromEmail) throw new Error('BREVO_SENDER_EMAIL is required when EMAIL_PROVIDER=brevo');
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: [{ email: Array.isArray(to) ? to[0] : to }],
        subject, htmlContent: html, textContent: text
      })
    });
    if (!res.ok) throw new Error('Brevo send failed: ' + (await res.text()));
    return await res.json().catch(() => ({}));
  }
  throw new Error('No email provider is configured.');
}

async function diagnostics() {
  const report = {
    activeProvider: providerName(),
    resend: {
      configured: resend.enabled(),
      from: resend.FROM_EMAIL,
      fromName: resend.FROM_NAME,
      domains: null,
      error: null
    },
    brevo: {
      configured: brevo.enabled(),
      sender: process.env.BREVO_SENDER_EMAIL || null
    },
    nodeVersion: process.version
  };
  if (resend.enabled()) {
    try {
      const d = await resend.listDomains();
      report.resend.domains = (d && d.data ? d.data : []).map(x => ({
        id: x.id, name: x.name, status: x.status, region: x.region, created_at: x.created_at
      }));
    } catch (err) {
      report.resend.error = err.message;
      report.resend.errorCause = err.cause ? {
        code: err.cause.code, errno: err.cause.errno, syscall: err.cause.syscall, hostname: err.cause.hostname
      } : null;
    }
  }
  return report;
}

module.exports = {
  providerName,
  enabled,
  sendWelcome,
  sendBirthday,
  sendBirthdayDigest,
  sendCampaign,
  diagnostics
};
