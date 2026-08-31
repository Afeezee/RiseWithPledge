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

From the dashboard you can:

- **Submissions** — view membership applications, volunteer registrations, pledges, contact/partnership messages, and newsletter subscribers. Each entry has a status workflow (new → contacted → approved/fulfilled/resolved), a detail view, and one-click email reply.
- **Content** — upload and manage team profiles (founder, board, management, coordinators, volunteers/advisors), projects (ongoing/completed/upcoming), success stories, news & events, gallery photos/videos, downloadable reports, and partner logos.
- **Impact Stats** — edit the numbers behind the animated Impact Dashboard.
- **Settings** — contact info, social links, and the bank account details shown on the Donate page and footer (account number is copy-to-clipboard everywhere it appears).

## Features

- Fully mobile-responsive, light/dark mode (remembered per visitor, follows system preference by default)
- All registration forms feed directly into the admin dashboard
- File uploads stored in `public/uploads/` for local runs
- Data stored in `data/db.json` for local runs (atomic writes; **back this folder up regularly** along with `public/uploads/`)

## Subscribers, campaigns & Brevo

Signup data (newsletter, volunteers, members, pledgers, partners, contact-form
submitters) is captured into a **Neon Postgres** `subscribers` table and pushed
to **Brevo** for welcome emails and campaign sends. This is separate from the
existing JSON store — which still keeps a per-form record for the admin
submissions views — so it survives cold starts on Vercel.

### One-time setup

1. **Neon** — create a project at [neon.tech](https://console.neon.tech), copy
   the pooled connection string into `DATABASE_URL`. The schema
   (`subscribers`, `campaigns`) is created automatically on first request.
2. **Brevo** — create an account at [brevo.com](https://www.brevo.com), then:
   - **Verify a sender** under *Senders & IPs* (the email set in
     `BREVO_SENDER_EMAIL` must be verified, otherwise campaigns cannot send).
   - **Create six contact lists** under *Contacts → Lists*:
     `Newsletter`, `Volunteers`, `Members`, `Pledgers`, `Partners`,
     `Contact form`. Copy each list's numeric id into the matching
     `BREVO_LIST_*` env var.
   - **Build a welcome automation per list** under *Automation*: trigger =
     "Contact added to list X" → action = send the welcome email for that
     signup type. (This is why we sync to Brevo on every signup — it fires
     the right welcome mail automatically.)
   - **Add an unsubscribe webhook** under *Transactional → Settings →
     Webhooks* (or *Marketing → Settings → Webhooks* depending on the
     account). URL: `https://<your-domain>/api/webhooks/brevo?secret=<value>`
     (secret must match `BREVO_WEBHOOK_SECRET`). Events: `unsubscribe`,
     `spam`. This keeps the local `subscribed` flag in sync so the admin
     counts stay accurate.
3. **Env vars** — see [.env.example](./.env.example) for the complete list.

### Admin campaigns dashboard

Once logged in, use **📣 Campaigns** in the sidebar to:

- See the count of currently opted-in contacts per audience.
- Compose a subject + HTML body, pick any combination of audiences (contacts
  are de-duplicated across lists on the Brevo side), and either send a test
  copy, schedule a future send, or send now.
- Review the send history (subject, audience, recipient count, status).

## Deployment notes

- Any Node.js host works (VPS, Render, Railway, etc.). Run `node server.js` behind a reverse proxy with HTTPS.
- Set a stable session secret in production: `SESSION_SECRET=<long random string>`
- On a fresh deployment, seed admin access with `SEED_ADMIN_USERS=user1@example.com,user2@example.com` and `SEED_ADMIN_PASSWORD=<strong temporary password>`.
- Vercel can run this app with the included configuration, but its filesystem is temporary. Uploads and JSON data reset across deployments and instances unless you move them to persistent storage.
- For Vercel production use, store live content in external services such as object storage for uploads and a database or hosted KV/SQL store for content/submissions.
