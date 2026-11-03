import express from 'express';
import cors from 'cors';
import { carsRouter } from './routes/cars.js';

export function createApp(database) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
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
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use((error, _req, res, _next) => {
    const status = error.status === 400 ? 400 : 500;
    res.status(status).json({ error: { code: status === 400 ? (error.code || 'INVALID_JSON') : 'INTERNAL_ERROR', message: status === 400 ? (error.code === 'INVALID_INPUT' ? error.message : 'Invalid JSON') : 'Unexpected error' } });
  });
  return app;
}
