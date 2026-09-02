// Uses Gemini (generativelanguage.googleapis.com) to pull structured
// job/exam info out of raw email text. Falls back to simple keyword/regex
// rules if the API key is missing, the call fails, or the response can't
// be parsed as JSON.

const GEMINI_MODEL = 'gemini-2.0-flash';

async function extractWithGemini(emailText) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('no GEMINI_API_KEY set');

  const prompt = `You extract structured data from an email so it can be tracked as a job application or an exam reminder.

Read the email below and respond with ONLY a JSON object (no markdown fences, no commentary) in this exact shape:
{
  "type": "job" | "exam" | "unknown",
  "title": string,          // e.g. "Software Engineer" or "DBMS Mid-Sem Exam"
  "organization": string,   // company name or institute/course name, "" if unknown
  "event_date": string,     // ISO date YYYY-MM-DD of the interview/deadline/exam date. "" if no date is mentioned.
  "status": string,         // for jobs: "applied"|"interview"|"offer"|"rejected"; for exams: "scheduled"
  "notes": string           // 1-2 sentence summary of anything relevant (round, location, link, syllabus, etc.)
}
If the email isn't actually about a job application or an exam, return {"type": "unknown"}.

EMAIL:
"""
${emailText.slice(0, 8000)}
"""`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    }
  );

  if (!res.ok) throw new Error(`Gemini API error ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('empty Gemini response');

  const cleaned = text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);
  return parsed;
}

// Very rough fallback: keyword-based type guess + first date-looking string found.
function extractWithRegex(emailText) {
  const lower = emailText.toLowerCase();
  const isExam = /\b(exam|semester|mid-?sem|end-?sem|test|hall ticket|admit card)\b/.test(lower);
  const isJob = /\b(interview|application|applied|position|job|offer|hiring|recruiter|role)\b/.test(lower);

  const type = isExam && !isJob ? 'exam' : isJob ? 'job' : 'unknown';

  // Match common date formats: 12/08/2026, 12-08-2026, August 12 2026, 12 August 2026
  const dateMatch = emailText.match(
    /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+\d{4})\b/i
  );

  let event_date = '';
  if (dateMatch) {
    const parsed = new Date(dateMatch[0]);
    if (!isNaN(parsed.getTime())) {
      event_date = parsed.toISOString().slice(0, 10);
    }
  }

  const titleLine = emailText.split('\n').find((l) => l.trim().length > 0) || 'Untitled';

  return {
    type,
    title: titleLine.trim().slice(0, 120),
    organization: '',
    event_date,
    status: type === 'exam' ? 'scheduled' : 'applied',
    notes: 'Auto-extracted with fallback keyword rules — please review and edit.',
  };
}

async function extractInfo(emailText) {
  try {
    const result = await extractWithGemini(emailText);
    // Trust Gemini's verdict either way — including "unknown". Overriding a
    // correct "unknown" with a keyword-regex guess was causing unrelated
    // emails to get force-classified and imported, and made the "unknown ->
    // skip" filter downstream almost never actually fire.
    if (result && result.type) return { ...result, method: 'gemini' };
    // Gemini responded but the shape was unexpected (no `type` at all) -> fall back.
    const fallback = extractWithRegex(emailText);
    return { ...fallback, method: 'regex-after-gemini-malformed' };
  } catch (e) {
    // Gemini call itself failed (no API key, network error, bad JSON, etc.)
    // -> regex is a reasonable last resort here.
    const fallback = extractWithRegex(emailText);
    return { ...fallback, method: 'regex-fallback', error: e.message };
  }
}

module.exports = { extractInfo };
