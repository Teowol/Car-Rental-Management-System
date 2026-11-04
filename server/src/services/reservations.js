import { parseId, invalid, getCar } from './cars.js';
import { parseDateRange, findAlternatives, businessToday } from './availability.js';
import { authError, validateBody } from './auth.js';

function money(cents) { return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`; }
export function calculatePrice(dailyPrice, range) {
  const rentalDays = (Date.parse(range.endDate + 'T00:00:00Z') - Date.parse(range.startDate + 'T00:00:00Z')) / 86400000;
  const cents = BigInt(dailyPrice.replace('.', ''));
  return { dailyPrice, rentalDays, totalAmount: money(cents * BigInt(rentalDays)), currency: 'TRY' };
}
export async function quoteReservation(database, carId, range) {
  const car = await getCar(database, carId);
  if (!car) throw authError(404, 'CAR_NOT_FOUND', 'Car not found.');
  return { carId, ...range, ...calculatePrice(car.dailyPrice, range) };
}
export function parseBooking(body) {
  validateBody(body, ['carId', 'startDate', 'endDate', 'expectedDailyPrice']);
  if (!['number', 'string'].includes(typeof body.carId)) throw invalid('Enter a valid car ID.');
  const carId = parseId(String(body.carId));
  const range = parseDateRange({ startDate: body.startDate, endDate: body.endDate });
  if (body.expectedDailyPrice !== undefined && (typeof body.expectedDailyPrice !== 'string' || !/^\d{1,10}\.\d{2}$/.test(body.expectedDailyPrice))) throw invalid('Expected daily price must be a decimal string.');
  return { carId, ...range, expectedDailyPrice: body.expectedDailyPrice };
}
const selectReservation = `SELECT r.id, r.car_id, r.user_id, DATE_FORMAT(r.start_date, '%Y-%m-%d') AS start_date,
  DATE_FORMAT(r.end_date, '%Y-%m-%d') AS end_date, r.status, c.brand, c.model,
  p.daily_price, p.rental_days, p.total_amount, p.currency
  FROM reservations r JOIN cars c ON c.id = r.car_id LEFT JOIN reservation_prices p ON p.reservation_id = r.id`;
function toReservation(row) {
  return { id: row.id, carId: row.car_id, carName: `${row.brand} ${row.model}`, startDate: row.start_date, endDate: row.end_date,
    status: row.status, canCancel: ['pending', 'confirmed'].includes(row.status) && row.start_date > businessToday(),
    pricing: row.daily_price === null ? null : { dailyPrice: row.daily_price, rentalDays: row.rental_days, totalAmount: row.total_amount, currency: row.currency } };
}
async function readReservation(database, id, userId) {
  const [rows] = await database.execute(selectReservation + ' WHERE r.id = ? AND r.user_id = ?', [id, userId]);
  if (!rows.length) throw authError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found.');
  return toReservation(rows[0]);
}
export async function createReservation(database, userId, booking) {
  const connection = await database.getConnection();
  let id;
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await connection.beginTransaction();
    // Every booking/cancellation takes the same car lock first, including when no intervals exist.
    const [[car]] = await connection.execute('SELECT id, status, daily_price FROM cars WHERE id = ? FOR UPDATE', [booking.carId]);
    if (!car || car.status === 'inactive') throw authError(404, 'CAR_NOT_FOUND', 'Car not found.');
    if (booking.startDate < businessToday()) throw invalid('Pickup date cannot be in the past (Europe/Istanbul).');
    const [overlaps] = await connection.execute(`SELECT id FROM reservations WHERE car_id = ? AND status IN ('pending','confirmed')
      AND start_date < ? AND end_date > ? LIMIT 1 FOR UPDATE`, [booking.carId, booking.endDate, booking.startDate]);
    if (car.status !== 'active' || overlaps.length) throw authError(409, 'CAR_UNAVAILABLE', 'This car is no longer available for your dates.');
    const pricing = calculatePrice(car.daily_price, booking);
    if (booking.expectedDailyPrice !== undefined && Number(booking.expectedDailyPrice) !== Number(pricing.dailyPrice)) {
      throw Object.assign(authError(409, 'PRICE_CHANGED', 'The daily price changed. Review the new price before booking.'), { quote: { carId: booking.carId, startDate: booking.startDate, endDate: booking.endDate, ...pricing } });
    }
    const [insert] = await connection.execute('INSERT INTO reservations (user_id, car_id, start_date, end_date) VALUES (?, ?, ?, ?)', [userId, booking.carId, booking.startDate, booking.endDate]);
    id = insert.insertId;
    await connection.execute('INSERT INTO reservation_prices (reservation_id, daily_price, rental_days, total_amount) VALUES (?, ?, ?, ?)', [id, pricing.dailyPrice, pricing.rentalDays, pricing.totalAmount]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
  return readReservation(database, id, userId);
}
export async function bookWithAlternatives(database, userId, booking) {
  try { return await createReservation(database, userId, booking); }
  catch (error) {
    // Calculate recommendations after releasing the transaction's connection and locks.
    if (error.code === 'CAR_UNAVAILABLE') error.alternatives = await findAlternatives(database, { carId: booking.carId, startDate: booking.startDate, endDate: booking.endDate });
    throw error;
  }
}
export function parseReservationId(value) {
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 4294967295) throw invalid('Enter a valid reservation ID.');
  return Number(value);
}
export function parsePages(query) {
  for (const [key, value] of Object.entries(query)) {
    if (!['page', 'pageSize'].includes(key) || typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw invalid('Invalid reservation pagination.');
  }
  const page = Number(query.page ?? 1), pageSize = Number(query.pageSize ?? 10);
  if (page > 1000000 || pageSize > 50) throw invalid('Invalid reservation pagination.');
  return { page, pageSize };
}
export async function listReservations(database, userId, { page, pageSize }) {
  const [[count]] = await database.execute('SELECT COUNT(*) AS total FROM reservations WHERE user_id = ?', [userId]);
  const [rows] = await database.execute(selectReservation + ' WHERE r.user_id = ? ORDER BY r.id DESC LIMIT ? OFFSET ?', [userId, String(pageSize), String((page - 1) * pageSize)]);
  return { items: rows.map(toReservation), page, pageSize, total: count.total };
}
export async function cancelReservation(database, userId, id) {
  // Ownership is checked before locking; no caller can choose another customer's record.
  const reservation = await readReservation(database, id, userId);
  const connection = await database.getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM cars WHERE id = ? FOR UPDATE', [reservation.carId]);
    const [[row]] = await connection.execute("SELECT status, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date FROM reservations WHERE id = ? AND user_id = ? FOR UPDATE", [id, userId]);
    if (!row) throw authError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found.');
    if (row.status !== 'cancelled') {
      if (!['pending', 'confirmed'].includes(row.status) || row.start_date <= businessToday()) throw authError(409, 'CANNOT_CANCEL', 'Only pending or confirmed reservations before the pickup day can be cancelled.');
      await connection.execute("UPDATE reservations SET status = 'cancelled' WHERE id = ? AND user_id = ?", [id, userId]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  return readReservation(database, id, userId);
}
