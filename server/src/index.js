import { createApp } from './app.js';
import { pool } from './config/db.js';

const port = Number(process.env.PORT || process.env.SERVER_PORT || 3000);
const server = createApp(pool).listen(port, '0.0.0.0', () => {
  console.log(`SmartRent API listening on port ${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => { await pool.end(); process.exit(0); });
  });
}
