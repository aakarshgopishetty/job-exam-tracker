const { sql } = require('../lib/db');
const { isAdmin } = require('../lib/auth');
const { sendToAll } = require('../lib/push');

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

module.exports = async (req, res) => {
  const admin = isAdmin(req);

  if (req.method === 'GET') {
    // Viewers only see reviewed/published entries; admin sees everything
    // (this only matters for any leftover pre-existing unreviewed rows).
    const rows = admin
      ? (await sql`SELECT * FROM entries ORDER BY event_date ASC`).rows
      : (await sql`SELECT id, type, title, organization, event_date, status, notes
                   FROM entries WHERE reviewed = TRUE ORDER BY event_date ASC`).rows;
    return res.status(200).json(rows);
  }

  if (!admin) return res.status(401).json({ error: 'Admin only' });

  if (req.method === 'POST') {
    const { type, title, organization, event_date, status, notes, source, raw_source, notify_message } = req.body || {};
    if (!type || !title || !event_date) {
      return res.status(400).json({ error: 'type, title, and event_date are required' });
    }
    const { rows } = await sql`
      INSERT INTO entries (type, title, organization, event_date, status, notes, source, raw_source, reviewed)
      VALUES (${type}, ${title}, ${organization || ''}, ${event_date}, ${status || 'applied'}, ${notes || ''},
              ${source || 'manual'}, ${raw_source || null}, TRUE)
      RETURNING *`;
    const entry = rows[0];

    // Every manually-saved entry is published immediately (reviewed=TRUE),
    // so notify subscribers right away instead of waiting for the 1-day
    // reminder. Best-effort: a push failure should never fail the save.
    let notified = null;
    try {
      const { rows: subs } = await sql`SELECT endpoint, subscription FROM push_subscriptions`;
      if (subs.length) {
        const label = entry.type === 'exam' ? 'Exam' : 'Job';
        const result = await sendToAll(subs, {
          title: `New ${label.toLowerCase()} added`,
          body: (notify_message && notify_message.trim())
            ? notify_message.trim()
            : `${entry.title}${entry.organization ? ' @ ' + entry.organization : ''} — ${formatDate(entry.event_date)}`,
        });
        notified = { sent: result.sent, failed: result.failed };
        if (result.expiredEndpoints.length) {
          await sql`DELETE FROM push_subscriptions WHERE endpoint = ANY(${result.expiredEndpoints})`;
        }
      }
    } catch (e) {
      console.error('[entries] publish notification failed:', e.message);
    }

    return res.status(201).json({ ...entry, notified });
  }

  if (req.method === 'PUT') {
    const { id, type, title, organization, event_date, status, notes, reviewed } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const { rows } = await sql`
      UPDATE entries SET
        type = COALESCE(${type}, type),
        title = COALESCE(${title}, title),
        organization = COALESCE(${organization}, organization),
        event_date = COALESCE(${event_date}, event_date),
        status = COALESCE(${status}, status),
        notes = COALESCE(${notes}, notes),
        reviewed = COALESCE(${reviewed}, reviewed)
      WHERE id = ${id}
      RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(rows[0]);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    await sql`DELETE FROM entries WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
};