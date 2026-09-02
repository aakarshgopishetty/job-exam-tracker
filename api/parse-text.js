const { isAdmin } = require('../lib/auth');
const { extractInfo } = require('../lib/gemini');

// Admin pastes raw email/notice text (or text copy-pasted out of a PDF) and
// gets back a structured guess to review/edit before saving via POST /api/entries.
module.exports = async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin only' });
  if (req.method !== 'POST') return res.status(405).end();

  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });

  const extracted = await extractInfo(text);
  return res.status(200).json({ ...extracted, raw_source: text.slice(0, 4000) });
};
