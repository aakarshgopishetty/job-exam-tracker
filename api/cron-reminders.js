const { sql } = require('../lib/db');
const { sendToAll } = require('../lib/push');

// Triggered by Vercel Cron (see vercel.json). Checks reviewed entries whose
// event_date is exactly 1 day away and haven't been notified for it yet,
// then pushes a notification to every subscribed viewer. (The other half of
// the notification schedule — the instant "just published" ping — happens
// inline in api/entries.js when an entry is first saved.)
module.exports = async (req, res) => {
  // Vercel Cron sends a special header; also allow a shared secret for manual testing.
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { rows: subs } = await sql`SELECT endpoint, subscription FROM push_subscriptions`;
  if (!subs.length) return res.status(200).json({ message: 'No subscribers yet.' });

  const windows = [
    {
      label: 'tomorrow',
      select: () => sql`SELECT * FROM entries WHERE reviewed = TRUE AND event_date = (CURRENT_DATE + 1) AND notified_1d = FALSE`,
      markDone: (id) => sql`UPDATE entries SET notified_1d = TRUE WHERE id = ${id}`,
    },
  ];

  let totalSent = 0;
  let totalFailed = 0;
  const expiredEndpoints = new Set();

  for (const w of windows) {
    const { rows: due } = await w.select();

    for (const entry of due) {
      const label = entry.type === 'exam' ? 'Exam' : 'Job';
      const payload = {
        title: `${label} reminder — ${w.label}`,
        body: `${entry.title}${entry.organization ? ' @ ' + entry.organization : ''} — ${entry.event_date}`,
      };
      const result = await sendToAll(subs, payload);
      totalSent += result.sent;
      totalFailed += result.failed;
      result.expiredEndpoints.forEach((ep) => expiredEndpoints.add(ep));
      console.log(`[cron-reminders] entry ${entry.id} (${w.label}): sent=${result.sent} failed=${result.failed}`);
      // Mark done even on partial failure — this flag means "we attempted this
      // window for this entry", not "every subscriber got it". Retrying a whole
      // day's reminder because one stale subscription 410'd isn't useful; the
      // expired-subscription cleanup below handles that case instead.
      await w.markDone(entry.id);
    }
  }

  // Unsubscribe endpoints the push service told us are gone (404/410) so they
  // stop failing — and stop silently eating every future reminder — forever.
  if (expiredEndpoints.size) {
    await sql`DELETE FROM push_subscriptions WHERE endpoint = ANY(${[...expiredEndpoints]})`;
  }

  return res.status(200).json({
    ok: true,
    notificationsSent: totalSent,
    notificationsFailed: totalFailed,
    subscriptionsRemoved: expiredEndpoints.size,
  });
};
