import { Router } from 'express';
import { requireAuth, requireAdmin, requireTrustedWrite, validateBody } from '../services/auth.js';
import { parseId } from '../services/cars.js';
import { parseAdminQuery, listAdminCars, getAdminCar, createAdminCar, updateAdminCar, listCustomers, getCustomer, updateCustomer, listAdminActivity, updateAdminReservation } from '../services/admin.js';

export function adminRouter(database) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(requireTrustedWrite, requireAuth(database), requireAdmin);
  router.get('/cars', async (req, res) => res.json(await listAdminCars(database, parseAdminQuery(req.query, 'cars'))));
  router.get('/cars/:id', async (req, res) => res.json({ car: await getAdminCar(database, parseId(req.params.id)) }));
  router.post('/cars', async (req, res) => res.status(201).json({ car: await createAdminCar(database, req.body) }));
  for (const method of ['put', 'patch']) router[method]('/cars/:id', async (req, res) => res.json({ car: await updateAdminCar(database, parseId(req.params.id), req.body, method === 'put') }));
  router.delete('/cars/:id', async (req, res) => {
    validateBody(req.body, []);
    res.json({ car: await updateAdminCar(database, parseId(req.params.id), { status: 'inactive' }) });
  });
  router.get('/customers', async (req, res) => res.json(await listCustomers(database, parseAdminQuery(req.query, 'customers'))));
  router.get('/customers/:id', async (req, res) => res.json({ customer: await getCustomer(database, parseId(req.params.id)) }));
  router.patch('/customers/:id', async (req, res) => res.json({ customer: await updateCustomer(database, parseId(req.params.id), req.body) }));
  router.get('/reservations', async (req, res) => res.json(await listAdminActivity(database, parseAdminQuery(req.query, 'reservations'), 'reservations')));
  router.patch('/reservations/:id', async (req, res) => res.json(await updateAdminReservation(database, parseId(req.params.id), req.body)));
  router.get('/payments', async (req, res) => res.json(await listAdminActivity(database, parseAdminQuery(req.query, 'payments'), 'payments')));
  return router;
}
