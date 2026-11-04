import { Router } from 'express';
import { getCar, listCars, parseFilters, parseId } from '../services/cars.js';
import { parseDateRange, checkAvailability, findAlternatives } from '../services/availability.js';
import { quoteReservation } from '../services/reservations.js';

export function carsRouter(database) {
  const router = Router();
  router.get('/', async (req, res) => res.json(await listCars(database, parseFilters(req.query))));
  // Register the named route before /:id so "alternatives" is never parsed as an ID.
  router.get('/alternatives', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await findAlternatives(database, parseDateRange(req.query, { alternatives: true })));
  });
  router.get('/:id/availability', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await checkAvailability(database, parseId(req.params.id), parseDateRange(req.query)));
  });
  router.get('/:id/quote', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await quoteReservation(database, parseId(req.params.id), parseDateRange(req.query)));
  });
  router.get('/:id', async (req, res) => {
    const car = await getCar(database, parseId(req.params.id));
    if (!car) return res.status(404).json({ error: { code: 'CAR_NOT_FOUND', message: 'Car not found.' } });
    res.json(car);
  });
  return router;
}
