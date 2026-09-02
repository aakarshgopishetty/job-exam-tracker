const { createEvents } = require('ics');
const { sql } = require('../lib/db');

module.exports = async (req, res) => {
  const { rows } = await sql`
    SELECT type, title, organization, event_date, notes
    FROM entries WHERE reviewed = TRUE AND event_date IS NOT NULL
    ORDER BY event_date ASC`;

  const events = rows.map((e) => {
    const [y, m, d] = e.event_date.toISOString().slice(0, 10).split('-').map(Number);
    const label = e.type === 'exam' ? 'Exam' : 'Job';
    return {
      title: `${label}: ${e.title}${e.organization ? ' @ ' + e.organization : ''}`,
      description: e.notes || '',
      start: [y, m, d],
      duration: { hours: 1 },
    };
  });

  const { error, value } = createEvents(events);
  if (error) return res.status(500).json({ error: error.message });

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="reminders.ics"');
  return res.status(200).send(value);
};
