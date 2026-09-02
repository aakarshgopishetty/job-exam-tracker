# Deadline Board

A personal job-application & exam reminder tracker:
- **You (admin)** log in with a password and add entries manually — either by typing them into the form, or by pasting email/notice text (or text copied out of a PDF) and letting an AI (Gemini) pre-fill the form for you to review before saving.
- **Anyone with the link (no login)** sees the public "board" of upcoming deadlines and can opt in to browser push notifications. They can also download a `.ics` calendar file.
- It's a PWA — installable on phone or laptop ("Add to Home Screen" / the install icon in the browser bar).

## 1. Notifications

Every entry you save is published immediately, and subscribers are notified in three ways:
- **On publish** — the moment you save a new entry, everyone subscribed gets a push notification about it.
- **1 day before** — `vercel.json` schedules `/api/cron-reminders` to run once a day (03:00 UTC — edit the cron string for a different time) and pings anyone who hasn't been notified yet for an entry due tomorrow.
- **On demand** — the admin panel has a "Notify all subscribers now" button for anything else you want to broadcast (a custom message, or just "check the board").

Vercel Cron on the free (Hobby) plan runs at most once a day — for a tighter check window you'd need a paid plan or an external cron hitting `/api/cron-reminders` with the `CRON_SECRET` bearer token.

## 2. Things to create before deploying

### a) Gemini API key (optional, for the "paste + AI extract" helper)
Get one free at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Without it, pasted text still gets processed by a simple keyword/regex fallback — you can always fix up a guess in the form before saving.

### b) VAPID keys (for push notifications)
Run locally once:
```bash
npx web-push generate-vapid-keys
```
Copy the public/private key pair it prints out.

### c) Admin password + session secret
Pick a strong password (`ADMIN_PASSWORD`) and a random 32+ character string (`ADMIN_SESSION_SECRET`) — a password manager's "generate password" feature works fine for the secret.

## 3. Deploy to Vercel

1. Push this folder to a new GitHub repo.
2. In Vercel: **Add New → Project** → import that repo.
3. **Storage tab → Create Database → Postgres** → connect it to this project.
4. **Settings → Environment Variables** → add everything from `.env.example` (using your real values from step 2), making sure the Postgres connection string env var name matches what `lib/db.js` reads (`DATABASE_URL`) — rename it if Vercel gave it a different name (e.g. `POSTGRES_URL`).
5. Deploy.
6. Run the schema once: open **Storage → your database → Query** in the Vercel dashboard and paste the contents of `schema.sql`, then run it. (Or connect with `psql` using the connection string shown in the Storage tab.)
7. Visit `https://YOUR-VERCEL-DOMAIN/admin.html`, log in with `ADMIN_PASSWORD`, and add your first entry.
8. Share `https://YOUR-VERCEL-DOMAIN/` with whoever should see the board and get reminders — they just click **Enable notifications**.

## 4. Local structure

```
public/            → static frontend (viewer + admin), PWA manifest & service worker
api/               → Vercel serverless functions (Node)
lib/               → shared helpers (db, auth, Gemini call, web-push)
schema.sql         → run once against your Postgres database
vercel.json        → cron schedule (1-day-before reminder check)
```

## 5. Upgrading from an older version with Gmail sync

If you previously deployed the Gmail-sync version of this app, your database may have leftover `notified_3d` / `notified_0d` columns, a `gmail_tokens` table, and possibly entries with `reviewed = FALSE` sitting unconfirmed (the admin panel no longer has a review queue, so those would otherwise be invisible). Run this once:
```sql
ALTER TABLE entries DROP COLUMN IF EXISTS notified_3d;
ALTER TABLE entries DROP COLUMN IF EXISTS notified_0d;
UPDATE entries SET reviewed = TRUE WHERE reviewed = FALSE;
DROP TABLE IF EXISTS gmail_tokens;
```
You can also remove the `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` env vars from your Vercel project — they're no longer used.
