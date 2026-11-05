import { Router } from 'express';
import { requireAuth, requireTrustedWrite, validateBody } from '../services/auth.js';
import { parseBooking, bookWithAlternatives, parsePages, listReservations, parseReservationId, cancelReservation, readReservation } from '../services/reservations.js';
import { completeRental } from '../services/payments.js';

export function reservationsRouter(database) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(requireTrustedWrite, requireAuth(database));
  router.post('/', async (req, res) => res.status(201).json({ reservation: await bookWithAlternatives(database, req.user.id, parseBooking(req.body)) }));
  router.get('/mine', async (req, res) => res.json(await listReservations(database, req.user.id, parsePages(req.query))));
  router.patch('/:id/cancel', async (req, res) => {
    validateBody(req.body, []);
    res.json({ reservation: await cancelReservation(database, req.user.id, parseReservationId(req.params.id)) });
  });
  router.patch('/:id/complete', async (req, res) => {
    validateBody(req.body, []);
    const id = parseReservationId(req.params.id);
    const completion = await completeRental(database, req.user.id, id);
    res.json({ ...completion, reservation: await readReservation(database, id, req.user.id) });
  });
  return router;
}
