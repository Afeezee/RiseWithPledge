/**
 * HTML email templates.
 *
 * Kept as plain tagged-template strings so we don't drag in a template
 * engine or build step. Each template takes a `vars` object with
 * { fullName, unsubscribeUrl, ...customFields } and returns { subject, html, text }.
 */

const SITE_URL  = process.env.SITE_URL  || 'https://risewithpledge.org';
const SITE_NAME = process.env.SITE_NAME || 'Rise With Pledge Foundation';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function frame(innerHtml, unsubscribeUrl) {
  const unsub = unsubscribeUrl
    ? `<p style="font-size:12px;color:#999;margin-top:28px;text-align:center">
         You are receiving this because you signed up at
         <a href="${esc(SITE_URL)}" style="color:#999">${esc(SITE_NAME)}</a>.
         <br><a href="${esc(unsubscribeUrl)}" style="color:#999">Unsubscribe</a>.
       </p>`
    : '';
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#f6f7fb;margin:0;padding:24px;color:#222">
<div style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.06)">
  <div style="background:#0042ab;color:#fff;padding:22px 28px">
    <div style="font-weight:800;font-size:18px">${esc(SITE_NAME)}</div>
  </div>
  <div style="padding:28px">${innerHtml}</div>
</div>
${unsub}
</body></html>`;
}

function greet(fullName) {
  const first = String(fullName || '').trim().split(/\s+/)[0];
  return first ? `Hi ${esc(first)},` : 'Hello,';
}

// ---------- WELCOME TEMPLATES (one per source) ----------

const WELCOME = {
  newsletter: ({ fullName }) => ({
    subject: `Welcome to the ${SITE_NAME} newsletter`,
    html: `
      <h1 style="color:#0042ab;margin:0 0 16px">Welcome aboard!</h1>
      <p>${greet(fullName)}</p>
      <p>Thank you for subscribing to the ${esc(SITE_NAME)} newsletter. You'll hear from us whenever there are programme updates, impact stories, volunteer opportunities and upcoming events.</p>
      <p>In the meantime, you can explore our ongoing work and success stories:</p>
      <p><a href="${esc(SITE_URL)}" style="display:inline-block;background:#0042ab;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px">Visit the website →</a></p>
      <p>Warmly,<br>The ${esc(SITE_NAME)} Team</p>
    `
  }),
  membership: ({ fullName }) => ({
    subject: `Thank you for joining ${SITE_NAME}`,
    html: `
      <h1 style="color:#0042ab;margin:0 0 16px">You're now part of the family</h1>
      <p>${greet(fullName)}</p>
      <p>We're thrilled that you've applied to become a member of ${esc(SITE_NAME)}. Our team will review your application and get in touch shortly with next steps.</p>
      <p>Members enjoy:</p>
      <ul>
        <li>Participation in Foundation programmes and activities</li>
        <li>Access to networking and development opportunities</li>
        <li>Opportunities to contribute ideas and expertise</li>
        <li>Regular updates on projects and impact</li>
      </ul>
      <p>Welcome!<br>The ${esc(SITE_NAME)} Team</p>
    `
  }),
  volunteer: ({ fullName }) => ({
    subject: `Thank you for volunteering with ${SITE_NAME}`,
    html: `
      <h1 style="color:#0042ab;margin:0 0 16px">Thank you for stepping up</h1>
      <p>${greet(fullName)}</p>
      <p>Your volunteer registration has been received. We'll be in touch with onboarding details shortly — including the programmes that best match your availability and interests.</p>
      <p>Volunteers are the heart of our work. Thank you for the time and care you're offering.</p>
      <p>Warmly,<br>The ${esc(SITE_NAME)} Team</p>
    `
  }),
  pledge: ({ fullName }) => ({
    subject: `Thank you for your pledge to ${SITE_NAME}`,
    html: `
      <h1 style="color:#0042ab;margin:0 0 16px">We've received your pledge</h1>
      <p>${greet(fullName)}</p>
      <p>Thank you for choosing to turn a special moment into an opportunity to change lives. We've received your pledge and our team will reach out to coordinate fulfilment.</p>
      <p>Every pledge contributes to transforming lives and building stronger communities — thank you.</p>
      <p>With gratitude,<br>The ${esc(SITE_NAME)} Team</p>
    `
  }),
  partner: ({ fullName }) => ({
    subject: `Partnership enquiry received — ${SITE_NAME}`,
    html: `
      <h1 style="color:#0042ab;margin:0 0 16px">Thank you for reaching out</h1>
      <p>${greet(fullName)}</p>
      <p>Your partnership enquiry has been received. Our team will review it and reach out shortly to discuss how we can collaborate.</p>
      <p>Together, we can create sustainable solutions that empower lives and transform communities.</p>
      <p>Warmly,<br>The ${esc(SITE_NAME)} Team</p>
    `
  }),
  contact: ({ fullName }) => ({
    subject: `We received your message — ${SITE_NAME}`,
    html: `
      <h1 style="color:#0042ab;margin:0 0 16px">Thank you for getting in touch</h1>
      <p>${greet(fullName)}</p>
      <p>Your message has reached our team. We'll respond as soon as possible.</p>
      <p>Warmly,<br>The ${esc(SITE_NAME)} Team</p>
    `
  })
};

function welcome(source, vars) {
  const build = WELCOME[source] || WELCOME.newsletter;
  const { subject, html } = build(vars || {});
  return {
    subject,
    html: frame(html, vars && vars.unsubscribeUrl),
    text: stripHtml(html)
  };
}

function birthday(vars) {
  const fullName = vars && vars.fullName;
  const subject = `🎂 Happy Birthday from ${SITE_NAME}!`;
  const html = `
    <h1 style="color:#0042ab;margin:0 0 16px">Happy Birthday${fullName ? ', ' + esc(fullName.split(/\s+/)[0]) : ''}! 🎉</h1>
    <p>From everyone at ${esc(SITE_NAME)}, we're wishing you a day as bright as your spirit and a year ahead filled with joy, good health and purpose.</p>
    <p>Thank you for being part of our community — your support helps empower lives and transform communities.</p>
    <p>With warm wishes,<br>The ${esc(SITE_NAME)} Team</p>
  `;
  return {
    subject,
    html: frame(html, vars && vars.unsubscribeUrl),
    text: stripHtml(html)
  };
}

function birthdayDigest({ sent = [], failed = [], skipped = [] }) {
  const today = new Date().toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const list = (arr) => arr.length
    ? '<ul>' + arr.map(x => `<li>${esc(x.name || '(no name)')} — ${esc(x.email || '(no email)')}${x.reason ? ' <em>(' + esc(x.reason) + ')</em>' : ''}${x.error ? ' <em style="color:#b33">(' + esc(x.error) + ')</em>' : ''}</li>`).join('') + '</ul>'
    : '<p style="color:#888">None.</p>';
  const html = `
    <h1 style="color:#0042ab;margin:0 0 16px">Birthday digest — ${esc(today)}</h1>
    <p><b>Greeted (${sent.length})</b></p>${list(sent)}
    ${failed.length ? `<p><b>Failed to send (${failed.length})</b></p>${list(failed)}` : ''}
    ${skipped.length ? `<p style="color:#888"><b>Skipped (${skipped.length})</b></p>${list(skipped)}` : ''}
    <p style="margin-top:20px;color:#888;font-size:13px">Automated birthday run from ${esc(SITE_NAME)}.</p>
  `;
  return {
    subject: `[Rise With Pledge] Birthday digest — ${sent.length} sent`,
    html: frame(html, null),
    text: stripHtml(html)
  };
}

function campaign(subject, bodyHtml, unsubscribeUrl) {
  return {
    subject,
    html: frame(bodyHtml, unsubscribeUrl),
    text: stripHtml(bodyHtml)
  };
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = { welcome, birthday, birthdayDigest, campaign };
