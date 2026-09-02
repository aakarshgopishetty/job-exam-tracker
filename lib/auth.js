const jwt = require('jsonwebtoken');
const cookie = require('cookie');

const COOKIE_NAME = 'admin_session';
const SECRET = process.env.ADMIN_SESSION_SECRET; // set this in Vercel env vars (any long random string)

function issueSessionCookie() {
  const token = jwt.sign({ role: 'admin' }, SECRET, { expiresIn: '30d' });
  return cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

function clearSessionCookie() {
  return cookie.serialize(COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

function isAdmin(req) {
  try {
    const cookies = cookie.parse(req.headers.cookie || '');
    const token = cookies[COOKIE_NAME];
    if (!token) return false;
    const payload = jwt.verify(token, SECRET);
    return payload.role === 'admin';
  } catch (e) {
    return false;
  }
}

module.exports = { issueSessionCookie, clearSessionCookie, isAdmin, COOKIE_NAME };
