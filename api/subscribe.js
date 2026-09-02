const { sql } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method === 'DELETE') {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return res.status(405).end();

  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }

  try {
    await sql`
      INSERT INTO push_subscriptions (endpoint, subscription)
      VALUES (${subscription.endpoint}, ${JSON.stringify(subscription)})
      ON CONFLICT (endpoint) DO UPDATE SET subscription = ${JSON.stringify(subscription)}`;
    return res.status(201).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
