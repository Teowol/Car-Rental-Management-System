import { Router } from 'express';
import { requireAuth, requireAdmin, requireTrustedWrite, validateBody } from '../services/auth.js';
import { parsePages, parseReservationId } from '../services/reservations.js';
import { parseSimulation, simulatePayment, listPayments, loyaltySummary, refundPayment } from '../services/payments.js';

export function paymentsRouter(database) {
  const router = Router();
  router.use(['/payments', '/loyalty', '/admin/payments'], (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, requireTrustedWrite, requireAuth(database));
  router.post('/payments/simulate', async (req, res) => res.json(await simulatePayment(database, req.user.id, parseSimulation(req.body))));
  router.get('/payments/mine', async (req, res) => res.json(await listPayments(database, req.user.id, parsePages(req.query))));
  router.get('/loyalty/mine', async (req, res) => res.json(await loyaltySummary(database, req.user.id, parsePages(req.query))));
  router.post('/admin/payments/:id/refund', requireAdmin, async (req, res) => {
    validateBody(req.body, []);
    res.json(await refundPayment(database, parseReservationId(req.params.id)));
  });
  return router;
}
