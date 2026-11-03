import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = process.env.DATABASE_DIR || fileURLToPath(new URL('../../../database/', import.meta.url));

export async function migrate(database) {
  const connection = await database.getConnection();
  let locked = false;
  try {
    const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 30) AS acquired', ['smartrent_migrations']);
    if (Number(lock.acquired) !== 1) throw new Error('Migration lock unavailable');
    locked = true;
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY, checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
    const files = (await readdir(path.join(directory, 'migrations'))).filter(file => /^\d+[-\w]*\.sql$/.test(file)).sort();
    for (const name of files) {
      const sql = (await readFile(path.join(directory, 'migrations', name), 'utf8')).replace(/\r\n/g, '\n');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const [rows] = await connection.execute('SELECT checksum FROM schema_migrations WHERE name = ?', [name]);
      if (rows.length) {
        if (rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      // Each file is one restart-safe SQL statement: MySQL DDL auto-commits.
      await connection.query(sql);
      await connection.execute('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [name, checksum]);
    }
  } finally {
    try { if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', ['smartrent_migrations']); }
    finally { connection.release(); }
  }
}

export async function seed(database) {
  if (!['development', 'test'].includes(process.env.NODE_ENV)) throw new Error('Seed requires NODE_ENV=development or test');
  const sql = await readFile(path.join(directory, 'seed.sql'), 'utf8');
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(sql);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}
