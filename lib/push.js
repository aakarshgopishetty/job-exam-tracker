const webpush = require('web-push');

if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  // setVapidDetails() throws synchronously on bad/missing keys, which would
  // otherwise crash this module on import (and take down every endpoint
  // that requires it, e.g. cron-reminders) with an unhelpful stack trace.
  console.error('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set — push notifications will not work.');
} else {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Sends to every subscription and reports back what happened instead of
// swallowing failures. Previously this used Promise.allSettled and threw
// away the results, so a bad VAPID key, a malformed payload, or an expired
// subscription would fail *silently* — the caller had no way to know, and
// still marked the reminder as sent (so it could never retry).
async function sendToAll(subscriptions, payload) {
  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(sub.subscription, JSON.stringify(payload)).then(
        () => ({ endpoint: sub.endpoint, ok: true }),
        (err) => ({ endpoint: sub.endpoint, ok: false, statusCode: err.statusCode, message: err.message })
      )
    )
  );

  const outcomes = results.map((r) => r.value);
  const failures = outcomes.filter((o) => !o.ok);
  const expired = failures.filter((o) => o.statusCode === 404 || o.statusCode === 410);

  if (failures.length) {
    // Log every failure with its actual reason (visible in Vercel function logs) —
    // this is the piece that was previously invisible.
    for (const f of failures) {
      console.error(`[push] send failed for ${f.endpoint}: ${f.statusCode || ''} ${f.message}`);
    }
  }

  return { sent: outcomes.length - failures.length, failed: failures.length, expiredEndpoints: expired.map((e) => e.endpoint) };
}

module.exports = { webpush, sendToAll };
