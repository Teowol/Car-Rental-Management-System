import { pool } from '../src/config/db.js';
import { migrate, seed } from '../src/database/setup.js';

try {
  const action = process.argv[2];
  if (action === 'migrate') await migrate(pool);
  else if (action === 'seed') await seed(pool);
  else throw new Error('Expected migrate or seed');
  console.log(`Database ${action} completed.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
