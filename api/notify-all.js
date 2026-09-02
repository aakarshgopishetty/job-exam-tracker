const { sql } = require('../lib/db');
const { isAdmin } = require('../lib/auth');
const { sendToAll } = require('../lib/push');

// Manual broadcast: admin clicks "Notify all subscribers" (optionally with a
// custom message) and every current push subscriber gets it immediately.
// Separate from the automatic notifications (on publish, 1 day before).
module.exports = async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin only' });
  if (req.method !== 'POST') return res.status(405).end();

  const { title, message } = req.body || {};

  const { rows: subs } = await sql`SELECT endpoint, subscription FROM push_subscriptions`;
  if (!subs.length) return res.status(200).json({ sent: 0, failed: 0, message: 'No subscribers yet.' });

  const payload = {
    title: (title && title.trim()) || 'Deadline Board',
    body: (message && message.trim()) || 'New updates are on the board — take a look.',
  };

  const result = await sendToAll(subs, payload);

  if (result.expiredEndpoints.length) {
    await sql`DELETE FROM push_subscriptions WHERE endpoint = ANY(${result.expiredEndpoints})`;
  }

  return res.status(200).json({
    sent: result.sent,
    failed: result.failed,
    subscriptionsRemoved: result.expiredEndpoints.length,
  });
};
