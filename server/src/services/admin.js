import { invalid, toCar } from './cars.js';
import { authError, validateBody, profileValues, publicUser } from './auth.js';
import { parsePages } from './reservations.js';
import { businessToday } from './availability.js';
import { withReservationLock, completeRental, refundWithinTransaction, readPayment } from './payments.js';

export const carStatuses = ['active', 'maintenance', 'inactive'];
const reservationStatuses = ['pending', 'confirmed', 'cancelled', 'completed'];
const paymentStatuses = ['pending', 'paid', 'failed', 'refunded'];
export function parseAdminQuery(query, kind) {
  const statuses = kind === 'cars' ? carStatuses : kind === 'reservations' ? reservationStatuses : kind === 'payments' ? paymentStatuses : [];
  for (const [key, value] of Object.entries(query)) if (!['page', 'pageSize', 'search', ...(statuses.length ? ['status'] : [])].includes(key) || typeof value !== 'string') throw invalid('Unsupported or repeated admin filter.');
  const search = (query.search || '').trim();
  if (search.length > 100) throw invalid('Search must be 100 characters or fewer.');
  if (query.status && !statuses.includes(query.status)) throw invalid('Invalid status filter.');
  return { ...parsePages(Object.fromEntries(Object.entries(query).filter(([key]) => ['page', 'pageSize'].includes(key)))), search, status: query.status || '' };
}
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) throw invalid(`${label} is invalid.`);
  return value.trim();
}
export function validateCar(body) {
  validateBody(body, ['vehicleCode', 'brand', 'model', 'category', 'seats', 'transmission', 'fuelType', 'dailyPrice', 'imageUrl', 'status']);
  const vehicleCode = text(body.vehicleCode, 30, 'Vehicle code');
  if (!/^[A-Za-z0-9_-]+$/.test(vehicleCode)) throw invalid('Vehicle code may contain letters, numbers, hyphens and underscores.');
  const brand = text(body.brand, 60, 'Brand'), model = text(body.model, 80, 'Model');
  if (!['economy', 'sedan', 'suv', 'van', 'premium'].includes(body.category) || !['manual', 'automatic'].includes(body.transmission) || !['petrol', 'diesel', 'hybrid', 'electric'].includes(body.fuelType) || !carStatuses.includes(body.status)) throw invalid('Choose valid vehicle attributes.');
  if (!Number.isInteger(body.seats) || body.seats < 1 || body.seats > 20) throw invalid('Seats must be an integer from 1 to 20.');
  if (typeof body.dailyPrice !== 'string' || !/^\d{1,10}(\.\d{1,2})?$/.test(body.dailyPrice)) throw invalid('Daily price must be a nonnegative decimal string with up to two decimal places.');
  const [whole, cents = ''] = body.dailyPrice.split('.');
  const dailyPrice = `${BigInt(whole)}.${cents.padEnd(2, '0')}`;
  const imageUrl = body.imageUrl === undefined || body.imageUrl === '' ? '/images/car-placeholder.svg' : text(body.imageUrl, 500, 'Image URL');
  let validImage = /^\/images\/[A-Za-z0-9/_.-]+$/.test(imageUrl) && !imageUrl.includes('..');
  if (!validImage) {
    try { const url = new URL(imageUrl); validImage = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { /* invalid URL */ }
  }
  if (!validImage) throw invalid('Use an HTTP(S) image URL or a path under /images/.');
  return { vehicleCode, brand, model, category: body.category, seats: body.seats, transmission: body.transmission, fuelType: body.fuelType, dailyPrice, imageUrl, status: body.status };
}
const adminCar = row => ({ ...toCar(row), vehicleCode: row.vehicle_code });
export async function getAdminCar(database, id) {
  const [[row]] = await database.execute('SELECT * FROM cars WHERE id = ?', [id]);
  if (!row) throw authError(404, 'CAR_NOT_FOUND', 'Car not found.');
  return adminCar(row);
}
export async function listAdminCars(database, filters) {
  const where = ['1=1'], values = [];
  if (filters.search) { where.push("LOCATE(?, CONCAT(vehicle_code, ' ', brand, ' ', model)) > 0"); values.push(filters.search); }
  if (filters.status) { where.push('status = ?'); values.push(filters.status); }
  const [[count]] = await database.execute('SELECT COUNT(*) AS total FROM cars WHERE ' + where.join(' AND '), values);
  const [rows] = await database.execute('SELECT * FROM cars WHERE ' + where.join(' AND ') + ' ORDER BY id DESC LIMIT ? OFFSET ?', [...values, String(filters.pageSize), String((filters.page - 1) * filters.pageSize)]);
  return { items: rows.map(adminCar), total: count.total, page: filters.page, pageSize: filters.pageSize };
}
const carColumns = 'vehicle_code, brand, model, category, seats, transmission, fuel_type, daily_price, image_url, status';
const carValues = car => [car.vehicleCode, car.brand, car.model, car.category, car.seats, car.transmission, car.fuelType, car.dailyPrice, car.imageUrl, car.status];
function duplicateCar(error) { if (error.code === 'ER_DUP_ENTRY') throw authError(409, 'VEHICLE_CODE_IN_USE', 'Vehicle code already exists.'); throw error; }
export async function createAdminCar(database, body) {
  const car = validateCar(body);
  let result;
  try { [result] = await database.execute(`INSERT INTO cars (${carColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, carValues(car)); }
  catch (error) { duplicateCar(error); }
  return getAdminCar(database, result.insertId);
}
export async function updateAdminCar(database, id, body, replace = false) {
  validateBody(body, carColumns.split(', ').map(column => ({ vehicle_code: 'vehicleCode', fuel_type: 'fuelType', daily_price: 'dailyPrice', image_url: 'imageUrl' })[column] || column));
  if (!Object.keys(body).length) throw invalid('Provide at least one vehicle field.');
  const connection = await database.getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED'); await connection.beginTransaction();
    const [[row]] = await connection.execute('SELECT * FROM cars WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw authError(404, 'CAR_NOT_FOUND', 'Car not found.');
    const previous = adminCar(row);
    // Strip API-only id/currency before passing the strict write allowlist.
    const { id: _id, currency: _currency, ...editable } = previous;
    const car = validateCar(replace ? body : { ...editable, ...body });
    if (car.status !== 'active') {
      const [blocking] = await connection.execute("SELECT id FROM reservations WHERE car_id = ? AND status IN ('pending','confirmed') AND end_date > ? LIMIT 1 FOR UPDATE", [id, businessToday()]);
      if (blocking.length) throw authError(409, 'CAR_HAS_RESERVATIONS', 'Cancel or resolve ongoing and upcoming reservations before taking this car out of service.');
    }
    await connection.execute(`UPDATE cars SET ${carColumns.split(', ').map(column => column + ' = ?').join(', ')} WHERE id = ?`, [...carValues(car), id]);
    await connection.commit();
  } catch (error) { await connection.rollback(); duplicateCar(error); }
  finally { connection.release(); }
  return getAdminCar(database, id);
}
export async function getCustomer(database, id) {
  const [[row]] = await database.execute("SELECT id, email, full_name, phone, role FROM users WHERE id = ? AND role = 'customer'", [id]);
  if (!row) throw authError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
  return publicUser(row);
}
export async function listCustomers(database, filters) {
  const values = [], where = ["role = 'customer'"];
  if (filters.search) { where.push("LOCATE(?, CONCAT(full_name, ' ', email, ' ', phone)) > 0"); values.push(filters.search); }
  const [[count]] = await database.execute('SELECT COUNT(*) AS total FROM users WHERE ' + where.join(' AND '), values);
  const [rows] = await database.execute('SELECT id, email, full_name, phone, role FROM users WHERE ' + where.join(' AND ') + ' ORDER BY id DESC LIMIT ? OFFSET ?', [...values, String(filters.pageSize), String((filters.page - 1) * filters.pageSize)]);
  return { items: rows.map(publicUser), total: count.total, page: filters.page, pageSize: filters.pageSize };
}
export async function updateCustomer(database, id, body) {
  validateBody(body, ['fullName', 'email', 'phone']);
  if (!Object.keys(body).length) throw invalid('Provide at least one profile field.');
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [[row]] = await connection.execute("SELECT id, full_name, email, phone, role FROM users WHERE id = ? AND role = 'customer' FOR UPDATE", [id]);
    if (!row) throw authError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
    const profile = profileValues({ ...publicUser(row), ...body });
    await connection.execute('UPDATE users SET full_name = ?, email = ?, phone = ? WHERE id = ?', [profile.fullName, profile.email, profile.phone, id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') throw authError(409, 'EMAIL_IN_USE', 'Email address already registered.');
    throw error;
  } finally { connection.release(); }
  return getCustomer(database, id);
}
export async function listAdminActivity(database, filters, kind) {
  const payments = kind === 'payments';
  const join = `FROM reservations r JOIN users u ON u.id = r.user_id JOIN cars c ON c.id = r.car_id
    ${payments ? 'JOIN' : 'LEFT JOIN'} payments pay ON pay.reservation_id = r.id LEFT JOIN reservation_prices p ON p.reservation_id = r.id`;
  const where = ['1=1'], values = [];
  if (filters.search) { where.push("LOCATE(?, CONCAT(r.id, ' ', COALESCE(pay.id, ''), ' ', u.full_name, ' ', u.email, ' ', c.brand, ' ', c.model)) > 0"); values.push(filters.search); }
  if (filters.status) { where.push((payments ? 'pay.status' : 'r.status') + ' = ?'); values.push(filters.status); }
  const [[count]] = await database.execute('SELECT COUNT(*) AS total ' + join + ' WHERE ' + where.join(' AND '), values);
  const [rows] = await database.execute(`SELECT r.id, r.user_id, r.car_id, r.status, u.full_name, u.email, c.brand, c.model,
    DATE_FORMAT(r.start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(r.end_date, '%Y-%m-%d') AS end_date,
    p.total_amount, pay.id AS payment_id, pay.status AS payment_status, pay.amount AS payment_amount
    ${join} WHERE ${where.join(' AND ')} ORDER BY ${payments ? 'pay' : 'r'}.id DESC LIMIT ? OFFSET ?`, [...values, String(filters.pageSize), String((filters.page - 1) * filters.pageSize)]);
  return { items: rows.map(row => ({ id: payments ? row.payment_id : row.id, reservationId: row.id, customerId: row.user_id, customerName: row.full_name,
    customerEmail: row.email, carId: row.car_id, carName: `${row.brand} ${row.model}`, startDate: row.start_date, endDate: row.end_date,
    status: payments ? row.payment_status : row.status, reservationStatus: row.status, paymentId: row.payment_id,
    paymentStatus: row.payment_status || 'pending', amount: payments ? row.payment_amount : row.total_amount, currency: 'TRY',
    canCancel: ['pending', 'confirmed'].includes(row.status), canComplete: row.status === 'confirmed' && row.payment_status === 'paid' && row.end_date <= businessToday(),
    canConfirm: row.status === 'pending' && row.payment_status === 'paid' && row.end_date > businessToday() })), total: count.total, page: filters.page, pageSize: filters.pageSize };
}
export async function updateAdminReservation(database, id, body) {
  validateBody(body, ['status']);
  if (!['confirmed', 'cancelled', 'completed'].includes(body.status)) throw invalid('Choose confirmed, cancelled or completed.');
  if (body.status === 'completed') return completeRental(database, null, id);
  return withReservationLock(database, id, null, async (connection, reservation) => {
    if (body.status === 'cancelled') {
      if (reservation.status === 'completed') throw authError(409, 'INVALID_TRANSITION', 'Completed rentals must use payment refund correction.');
      await refundWithinTransaction(connection, id);
      await connection.execute("UPDATE reservations SET status = 'cancelled' WHERE id = ?", [id]);
    } else {
      const payment = await readPayment(connection, id);
      if (!['pending', 'confirmed'].includes(reservation.status) || payment?.status !== 'paid' || reservation.end_date <= businessToday()) throw authError(409, 'INVALID_TRANSITION', 'Only active paid rentals may be confirmed.');
      const [[car]] = await connection.execute('SELECT status FROM cars WHERE id = (SELECT car_id FROM reservations WHERE id = ?)', [id]);
      if (car.status !== 'active') throw authError(409, 'CAR_UNAVAILABLE', 'Car is out of service.');
      const [overlaps] = await connection.execute("SELECT id FROM reservations WHERE car_id = (SELECT car_id FROM reservations WHERE id = ?) AND id <> ? AND status IN ('pending','confirmed') AND start_date < ? AND end_date > ? LIMIT 1 FOR UPDATE", [id, id, reservation.end_date, reservation.start_date]);
      if (overlaps.length) throw authError(409, 'CAR_UNAVAILABLE', 'Another reservation overlaps these dates.');
      await connection.execute("UPDATE reservations SET status = 'confirmed' WHERE id = ?", [id]);
    }
    return { reservationId: id, status: body.status };
  });
}
