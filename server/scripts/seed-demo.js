import { pool } from '../src/config/db.js';
import { seedDemo } from '../src/database/demo.js';
try {
  const summary = await seedDemo(pool, { password: process.env.DEMO_PASSWORD, customerEmail: process.env.DEMO_CUSTOMER_EMAIL, adminEmail: process.env.DEMO_ADMIN_EMAIL });
  console.log(JSON.stringify(summary, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await pool.end(); }
