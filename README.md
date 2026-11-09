# RisewithPledge.org

Website for **RISE WITH PLEDGE EDUCATION WELFARE AND EMPOWERMENT FOUNDATION**.

> "Empowering Lives, Transforming Communities, Building a Better Future Together."

## Running the website

```
npm install
npm start
```

- Public site: http://localhost:3000
- Admin dashboard: http://localhost:3000/admin

To run on a different port: set the `PORT` environment variable.

## Admin dashboard

Admin accounts load from `data/db.json` locally. On a fresh setup, bootstrap
admin access by setting `SEED_ADMIN_USERS` and `SEED_ADMIN_PASSWORD` before the
first start, then change the password in *Settings → Change Admin Password*.

On production (Vercel), admin accounts are mirrored into the Neon `admins`
table on boot so cold starts don't lose them.

From the dashboard you can:

- **Submissions** — view membership applications, volunteer registrations,
  pledges, contact/partnership messages, and newsletter subscribers. Each
  entry has a status workflow and a detail view.
- **Content** — upload and manage team profiles, projects, success stories,
  news & events, gallery photos/videos, downloadable reports, and partner
  logos. Files go to Vercel Blob in production and `public/uploads/` locally.
- **Impact Stats** — edit the numbers behind the animated Impact Dashboard.
- **Settings** — contact info, social links, and bank account details.
- **📣 Campaigns** — compose and send email updates to any combination of
  audiences via Resend (programmatic). Includes diagnostics.
- **🎂 Birthdays** — see members celebrating today and this fortnight, and
  the sent log. Vercel Cron fires `/api/cron/birthdays` daily at 07:00 UTC.

## Data persistence

| Data | Local dev | Production (Vercel) |
|---|---|---|
| Subscribers & campaigns | Neon Postgres (if `DATABASE_URL` set) | Neon Postgres |
| Content (team, projects, stories, news, gallery, reports, partners) | JSON file `data/db.json` | Neon Postgres (`content_items`) |
| Site settings + impact stats | JSON file | Neon Postgres (`site_settings`) |
| Submissions (members, volunteers, pledges, etc.) | JSON file | Neon Postgres (`submissions`) |
| Admin accounts | JSON file | Neon Postgres (`admins`) + JSON fallback |
| File uploads | `public/uploads/` | Vercel Blob |
| Birthday log | Neon Postgres (`birthday_messages`) | Neon Postgres |

The JSON file store (`data/db.json`) is still used in local development so
the site boots without any external services. Set `DATABASE_URL` and
`BLOB_READ_WRITE_TOKEN` to enable durable production storage — and all admin
content, uploads, and submissions survive Vercel cold starts.

## Email (Resend, with Brevo as fallback)

All email — welcome emails, birthday greetings, campaigns — is sent
programmatically from the server. The primary provider is **Resend**; **Brevo**
is wired as a fallback and selectable via `EMAIL_PROVIDER=brevo`.

### Resend setup (primary)

1. Create an account at [resend.com](https://resend.com).
2. Add your domain `risewithpledge.org` under **Domains** → **Add Domain**.
   Resend shows DNS records to add on your domain registrar:
   - 1 × `TXT` for SPF
   - 3 × `CNAME` for DKIM (resend._domainkey etc.)
   - Optionally 1 × `MX` for inbound (not required for sending)
   Add them, wait a few minutes, click **Verify**.
3. Create an API key under **API Keys** → paste into `RESEND_API_KEY`.
4. Set `RESEND_FROM_EMAIL=hello@risewithpledge.org` (or any address on the
   verified domain).
5. Under **Webhooks**, add one pointing to
   `https://risewithpledge.org/api/webhooks/resend?secret=<value>`
   (secret must match `RESEND_WEBHOOK_SECRET`). Events to enable:
   `email.bounced`, `email.complained`.
6. Run the diagnostic from **/admin → 📣 Campaigns → 🔧 Run email diagnostic**
   to confirm domain status.

### Brevo setup (fallback, optional)

Keep Brevo wired if you want to be able to switch providers via
`EMAIL_PROVIDER=brevo`. See `.env.example` for the full set of `BREVO_*`
env vars and the diagnostic endpoint `/api/admin/diagnostics/brevo`.

### Admin campaigns dashboard

Once logged in, use **📣 Campaigns** in the sidebar to:

- See the count of currently opted-in contacts per audience.
- Compose a subject + HTML body, pick any combination of audiences (contacts
  are de-duplicated across sources server-side), and either send a test copy,
  schedule a send, or send now.
- Review the send history (subject, audience, recipient count, status).

## Birthday automation

- Members include a `dateOfBirth` on the Membership registration form.
- Every day at 07:00 UTC, Vercel Cron hits `/api/cron/birthdays`.
- The job sends a personalized greeting via Resend to every member whose
  DOB matches the day, logs each send to `birthday_messages`, and emails
  `ADMIN_DIGEST_EMAIL` a summary of who was greeted.
- An admin can also trigger a run on demand from **/admin → 🎂 Birthdays**.

## Deployment notes (Vercel)

- Set these env vars in **Project → Settings → Environment Variables**:
  - `DATABASE_URL` (Neon)
  - `BLOB_READ_WRITE_TOKEN` (auto-set by Vercel after enabling Blob under
    Project → Storage → Blob)
  - `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`
  - `SITE_URL=https://risewithpledge.org`
  - `EMAIL_PROVIDER=resend` (or `brevo`)
  - `ADMIN_DIGEST_EMAIL`
  - `SESSION_SECRET` (long random string)
  - `CRON_SECRET` (Vercel auto-sends this via `Authorization: Bearer …`)
  - `SEED_ADMIN_USERS`, `SEED_ADMIN_PASSWORD` for first-time admin bootstrap
- Configure Vercel Blob: Project → Storage → Blob → Connect (1 GB free).
- Configure Resend DNS records on the domain registrar.
- Redeploy after setting env vars (env changes don't rebuild automatically).

## Features

- Fully mobile-responsive, light/dark mode (remembered per visitor, follows
  system preference by default)
- All registration forms feed directly into the admin dashboard
- Subscribers, content, uploads, campaigns, and birthday automation are all
  durable on Vercel via Neon Postgres + Vercel Blob
