import { fields, toCar, getCar, parseId, invalid } from './cars.js';

export const businessTimezone = 'Europe/Istanbul';
export function businessToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: businessTimezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1000-01-01') return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function parseDateRange(query, { alternatives = false, now = new Date() } = {}) {
  const allowed = alternatives ? ['carId', 'startDate', 'endDate'] : ['startDate', 'endDate'];
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key) || typeof value !== 'string') throw invalid('Unsupported or repeated availability parameter.');
  }
  const { startDate, endDate } = query;
  if (!validDate(startDate) || !validDate(endDate)) throw invalid('Enter valid pickup and return dates in YYYY-MM-DD format.');
  if (startDate >= endDate) throw invalid('Return date must be after pickup date.');
  if (startDate < businessToday(now)) throw invalid('Pickup date cannot be in the past (Europe/Istanbul).');
  return { startDate, endDate, ...(alternatives ? { carId: parseId(query.carId ?? '') } : {}) };
}

// End-exclusive overlap: existing.start < requested.end AND existing.end > requested.start.
// Pending reservations intentionally block without automatic expiry; cancelled/completed do not.
const overlap = `r.car_id = c.id AND r.status IN ('pending', 'confirmed') AND r.start_date < ? AND r.end_date > ?`;
function missingCar() { return Object.assign(new Error('Car not found.'), { status: 404, code: 'CAR_NOT_FOUND' }); }

export async function checkAvailability(database, carId, range) {
  const [rows] = await database.execute(`SELECT c.id, c.status,
    EXISTS(SELECT 1 FROM reservations r WHERE ${overlap}) AS has_overlap
    FROM cars c WHERE c.id = ? AND c.status <> 'inactive'`, [range.endDate, range.startDate, carId]);
  if (!rows.length) throw missingCar();
  const row = rows[0];
  const reason = row.status !== 'active' ? 'maintenance' : row.has_overlap ? 'reserved' : null;
  return { carId, ...range, available: reason === null, reason };
}

export async function findAlternatives(database, range) {
  const source = await getCar(database, range.carId);
  if (!source) throw missingCar();
  const [rows] = await database.execute(`SELECT ${fields.split(', ').map(field => 'c.' + field).join(', ')},
    CAST(ABS(c.daily_price - CAST(? AS DECIMAL(12,2))) AS DECIMAL(12,2)) AS price_difference
    FROM cars c WHERE c.status = 'active' AND c.id <> ?
    AND NOT EXISTS(SELECT 1 FROM reservations r WHERE ${overlap})
    ORDER BY (c.category <> ?) ASC, price_difference ASC,
      ABS(CAST(c.seats AS SIGNED) - ?) ASC, (c.transmission <> ?) ASC, c.id ASC LIMIT 6`,
  [source.dailyPrice, source.id, range.endDate, range.startDate, source.category, source.seats, source.transmission]);
  return { carId: source.id, startDate: range.startDate, endDate: range.endDate,
    ranking: ['category', 'dailyPriceDifference', 'seatDifference', 'transmission', 'id'],
    items: rows.map(row => ({ ...toCar(row), match: {
      sameCategory: row.category === source.category, dailyPriceDifference: row.price_difference,
      seatDifference: row.seats - source.seats, sameTransmission: row.transmission === source.transmission,
    } })) };
}
