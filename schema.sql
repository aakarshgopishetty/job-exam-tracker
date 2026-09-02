-- Run this once against your Vercel Postgres database (Storage tab -> Query, or `psql`).

CREATE TABLE IF NOT EXISTS entries (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('job', 'exam')),
  title TEXT NOT NULL,               -- e.g. "Software Engineer @ Acme" or "DBMS Mid-Sem"
  organization TEXT,                  -- company or institute
  event_date DATE,                    -- interview/deadline date or exam date; NULL until admin fills it in
  status TEXT DEFAULT 'applied',      -- applied / interview / offer / rejected (job) or scheduled (exam)
  notes TEXT,
  source TEXT DEFAULT 'manual',       -- kept for reference; everything is manual now
  raw_source TEXT,                    -- original pasted text, if extracted via "paste + AI" instead of the plain form
  reviewed BOOLEAN DEFAULT TRUE,      -- every manually-saved entry is published immediately
  notified_1d BOOLEAN DEFAULT FALSE,  -- so the 1-day-before cron doesn't double-notify
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  endpoint TEXT UNIQUE NOT NULL,
  subscription JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- If you're upgrading an existing database that had Gmail sync, this cleans
-- up what's no longer used (safe to run any time, and safe to skip):
--   ALTER TABLE entries DROP COLUMN IF EXISTS notified_3d;
--   ALTER TABLE entries DROP COLUMN IF EXISTS notified_0d;
--   UPDATE entries SET reviewed = TRUE WHERE reviewed = FALSE;
--   DROP TABLE IF EXISTS gmail_tokens;
