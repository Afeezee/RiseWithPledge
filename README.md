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

## Deployment notes

- Any Node.js host works (VPS, Render, Railway, etc.). Run `node server.js` behind a reverse proxy with HTTPS.
- Set a stable session secret in production: `SESSION_SECRET=<long random string>`
- On a fresh deployment, seed admin access with `SEED_ADMIN_USERS=user1@example.com,user2@example.com` and `SEED_ADMIN_PASSWORD=<strong temporary password>`.
- Vercel can run this app with the included configuration, but its filesystem is temporary. Uploads and JSON data reset across deployments and instances unless you move them to persistent storage.
- For Vercel production use, store live content in external services such as object storage for uploads and a database or hosted KV/SQL store for content/submissions.
