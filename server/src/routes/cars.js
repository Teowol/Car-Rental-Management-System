import { Router } from 'express';
import { getCar, listCars, parseFilters, parseId } from '../services/cars.js';

export function carsRouter(database) {
  const router = Router();
  router.get('/', async (req, res) => res.json(await listCars(database, parseFilters(req.query))));
  router.get('/:id', async (req, res) => {
    const car = await getCar(database, parseId(req.params.id));
    if (!car) return res.status(404).json({ error: { code: 'CAR_NOT_FOUND', message: 'Car not found.' } });
    res.json(car);
  });
  return router;
}
