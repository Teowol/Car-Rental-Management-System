import { pool } from '../src/config/db.js';
import { emailValue, passwordValue, hashPassword } from '../src/services/auth.js';
try {
  if (!['development', 'test'].includes(process.env.NODE_ENV)) throw new Error('Admin seed requires NODE_ENV=development or test');
  const email = emailValue(process.env.ADMIN_SEED_EMAIL);
  const passwordHash = await hashPassword(passwordValue(process.env.ADMIN_SEED_PASSWORD));
  // Never promote an existing customer or reset an existing administrator password.
  await pool.execute('INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)', [email, passwordHash, 'Development Admin', 'admin']);
  console.log('Development administrator created.');
} catch (error) {
  console.error(error.code === 'ER_DUP_ENTRY' ? 'Email already exists; no account changed.' : error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
