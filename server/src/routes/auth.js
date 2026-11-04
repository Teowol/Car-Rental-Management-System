import { Router } from 'express';
import { authError, validateBody, emailValue, passwordValue, profileValues, hashPassword, verifyPassword, publicUser, issueSession, readToken, tokenHash, sessionCookie, cookieOptions, requireAuth, requireAdmin } from '../services/auth.js';

export function accountRouter(database) {
  const router = Router();
  const authenticate = requireAuth(database);
  const attempts = new Map();
  // A bounded, per-process limiter for expensive password operations, before hashing.
  function limit(req, _res, next) {
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
    const key = req.ip;
    const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    if (entry.count >= 30 || (!attempts.has(key) && attempts.size >= 10000)) throw authError(429, 'RATE_LIMITED', 'Too many attempts. Try again in 15 minutes.');
    entry.count += 1; attempts.set(key, entry); next();
  }
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use((req, _res, next) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      // Exact Origin plus a custom header prevents cross-origin form/login CSRF.
      const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
      if (req.get('Origin') !== origin || req.get('X-Requested-With') !== 'SmartRent') throw authError(403, 'INVALID_ORIGIN', 'Request origin not allowed.');
      if (!req.is('application/json')) throw authError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.');
    }
    next();
  });
  router.post('/auth/register', limit, async (req, res) => {
    validateBody(req.body, ['email', 'password', 'fullName', 'phone']);
    const profile = profileValues(req.body);
    const password = passwordValue(req.body.password);
    const passwordHash = await hashPassword(password);
    let result;
    try {
      [result] = await database.execute('INSERT INTO users (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)', [profile.email, passwordHash, profile.fullName, profile.phone]);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw authError(409, 'EMAIL_IN_USE', 'Email address already registered.');
      throw error;
    }
    await issueSession(database, req, res, result.insertId);
    res.status(201).json({ user: { id: result.insertId, ...profile, role: 'customer' } });
  });
  let dummyHash;
  router.post('/auth/login', limit, async (req, res) => {
    validateBody(req.body, ['email', 'password']);
    const email = emailValue(req.body.email);
    const password = passwordValue(req.body.password);
    const [rows] = await database.execute('SELECT * FROM users WHERE email = ?', [email]);
    // Unknown users still perform password work to reduce account timing disclosure.
    dummyHash ||= hashPassword('unused-random-' + crypto.randomUUID());
    const valid = await verifyPassword(password, rows[0]?.password_hash || await dummyHash);
    if (!valid || !rows.length) throw authError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    await issueSession(database, req, res, rows[0].id);
    res.json({ user: publicUser(rows[0]) });
  });
  router.post('/auth/logout', async (req, res) => {
    validateBody(req.body, []);
    const token = readToken(req);
    if (token) await database.execute('DELETE FROM sessions WHERE token_hash = ?', [tokenHash(token)]);
    res.clearCookie(sessionCookie, cookieOptions());
    res.status(204).end();
  });
  router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));
  router.patch('/me', authenticate, async (req, res) => {
    validateBody(req.body, ['email', 'fullName', 'phone']);
    const profile = profileValues({ ...req.user, ...req.body });
    try {
      await database.execute('UPDATE users SET email = ?, full_name = ?, phone = ? WHERE id = ?', [profile.email, profile.fullName, profile.phone, req.user.id]);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw authError(409, 'EMAIL_IN_USE', 'Email address already registered.');
      throw error;
    }
    res.json({ user: { ...req.user, ...profile } });
  });
  router.get('/admin/access', authenticate, requireAdmin, (req, res) => res.json({ user: req.user }));
  return router;
}
