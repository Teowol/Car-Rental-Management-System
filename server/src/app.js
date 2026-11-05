import express from 'express';
import cors from 'cors';
import { carsRouter } from './routes/cars.js';
import { accountRouter } from './routes/auth.js';
import { reservationsRouter } from './routes/reservations.js';
import { paymentsRouter } from './routes/payments.js';

export function createApp(database) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      await database.query('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch {
      res.status(503).json({ status: 'unavailable', database: 'disconnected' });
    }
  });

  app.use('/api/cars', carsRouter(database));
  app.use('/api/reservations', reservationsRouter(database));
  app.use('/api', paymentsRouter(database));
  app.use('/api', accountRouter(database));
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use((error, _req, res, _next) => {
    const status = [400, 401, 403, 404, 409, 413, 415, 429].includes(error.status) ? error.status : 500;
    const message = status === 500 ? 'Unexpected error' : error.type === 'entity.parse.failed' ? 'Invalid JSON' : status === 413 ? 'Request body too large' : error.message;
    res.status(status).json({ error: { code: status === 500 ? 'INTERNAL_ERROR' : (error.code || 'INVALID_JSON'), message }, ...(error.code === 'CAR_UNAVAILABLE' && error.alternatives ? { alternatives: error.alternatives } : {}), ...(error.code === 'PRICE_CHANGED' ? { quote: error.quote } : {}) });
  });
  return app;
}
