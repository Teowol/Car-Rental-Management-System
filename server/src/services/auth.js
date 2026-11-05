import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { allowedClientOrigins } from '../config/origins.js';

const scrypt = promisify(scryptCallback);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export const sessionCookie = 'smartrent_session';
export const sessionDuration = 8 * 60 * 60 * 1000;
export function authError(status, code, message) { return Object.assign(new Error(message), { status, code }); }
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export const publicUser = row => ({ id: row.id, email: row.email, fullName: row.full_name, phone: row.phone, role: row.role });

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64, options);
  return `scrypt$32768$8$3$${salt}$${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$32768$8$3') return false;
  const actual = await scrypt(password, parts[4], 64, options);
  const expected = Buffer.from(parts[5], 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function validateBody(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) {
    throw authError(400, 'INVALID_INPUT', 'Unsupported request fields.');
  }
}
export function emailValue(value) {
  if (typeof value !== 'string') throw authError(400, 'INVALID_INPUT', 'Enter a valid email address.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[\x21-\x7e]+$/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw authError(400, 'INVALID_INPUT', 'Enter a valid email address.');
  }
  return email;
}
export function passwordValue(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw authError(400, 'INVALID_INPUT', 'Password must contain 12 to 128 characters.');
  return value;
}
export function profileValues(body) {
  if (typeof body.fullName !== 'string' || !body.fullName.trim() || body.fullName.trim().length > 100 || /[\x00-\x1f\x7f]/.test(body.fullName)) {
    throw authError(400, 'INVALID_INPUT', 'Enter a name of 1 to 100 characters.');
  }
  const phone = body.phone ?? '';
  if (typeof phone !== 'string' || phone.length > 30 || (phone && !/^[+\d ()-]+$/.test(phone))) throw authError(400, 'INVALID_INPUT', 'Enter a valid phone number (up to 30 characters).');
  return { email: emailValue(body.email), fullName: body.fullName.trim(), phone: phone.trim() };
}
export function readToken(req) {
  const entries = (req.headers.cookie || '').split(';').map(item => item.trim()).filter(item => item.startsWith(sessionCookie + '='));
  if (entries.length !== 1) return null;
  const token = entries[0].slice(sessionCookie.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export function cookieOptions() {
  return { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/api' };
}
export async function issueSession(database, req, res, userId) {
  const token = randomBytes(32).toString('hex');
  const previous = readToken(req);
  // Only digests are stored; a database read cannot recover a usable session cookie.
  await database.execute('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()');
  await database.execute('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [tokenHash(token), userId, new Date(Date.now() + sessionDuration)]);
  if (previous) await database.execute('DELETE FROM sessions WHERE token_hash = ?', [tokenHash(previous)]);
  res.cookie(sessionCookie, token, { ...cookieOptions(), maxAge: sessionDuration });
}
export function requireAuth(database) {
  return async (req, _res, next) => {
    const token = readToken(req);
    if (!token) throw authError(401, 'UNAUTHENTICATED', 'Please sign in.');
    const [rows] = await database.execute(`SELECT u.id, u.email, u.full_name, u.phone, u.role FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()`, [tokenHash(token)]);
    if (!rows.length) throw authError(401, 'UNAUTHENTICATED', 'Please sign in.');
    req.user = publicUser(rows[0]);
    next();
  };
}
export function requireAdmin(req, _res, next) {
  if (req.user.role !== 'admin') throw authError(403, 'FORBIDDEN', 'Administrator access required.');
  next();
}
export function requireTrustedWrite(req, _res, next) {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    if (!allowedClientOrigins().includes(req.get('Origin')) || req.get('X-Requested-With') !== 'SmartRent') throw authError(403, 'INVALID_ORIGIN', 'Request origin not allowed.');
    if (!req.is('application/json')) throw authError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.');
  }
  next();
}
