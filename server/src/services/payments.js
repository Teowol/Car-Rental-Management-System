import { authError, validateBody } from './auth.js';
import { businessToday } from './availability.js';

export const pointsForAmount = amount => (BigInt(amount.replace('.', '')) / 10000n).toString();
const paymentFields = `p.id, p.reservation_id, p.amount, p.currency, p.status, p.method_label,
  DATE_FORMAT(p.paid_at, '%Y-%m-%dT%H:%i:%sZ') AS paid_at,
  DATE_FORMAT(p.refunded_at, '%Y-%m-%dT%H:%i:%sZ') AS refunded_at`;
function paymentValue(row) {
  return { id: row.id, reservationId: row.reservation_id, amount: row.amount, currency: row.currency,
    status: row.status, methodLabel: row.method_label, paidAt: row.paid_at, refundedAt: row.refunded_at };
}
async function readPayment(connection, reservationId) {
  const [[row]] = await connection.execute(`SELECT ${paymentFields} FROM payments p WHERE p.reservation_id = ?`, [reservationId]);
  return row ? paymentValue(row) : null;
}
// Reuse car -> reservation -> payment lock order for payment, completion and refund.
export async function withReservationLock(database, reservationId, userId, action) {
  const [owned] = await database.execute(`SELECT car_id FROM reservations WHERE id = ?${userId === null ? '' : ' AND user_id = ?'}`, userId === null ? [reservationId] : [reservationId, userId]);
  if (!owned.length) throw authError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found.');
  const connection = await database.getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM cars WHERE id = ? FOR UPDATE', [owned[0].car_id]);
    const [[reservation]] = await connection.execute(`SELECT id, user_id, status, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
      DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date FROM reservations WHERE id = ? FOR UPDATE`, [reservationId]);
    if (!reservation || (userId !== null && reservation.user_id !== userId)) throw authError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found.');
    const result = await action(connection, reservation);
    await connection.commit(); return result;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
export function parseSimulation(body) {
  validateBody(body, ['reservationId', 'requestId', 'outcome']);
  if (!['number', 'string'].includes(typeof body.reservationId) || !/^[1-9]\d*$/.test(String(body.reservationId)) || Number(body.reservationId) > 4294967295) throw authError(400, 'INVALID_INPUT', 'Enter a valid reservation ID.');
  if (typeof body.requestId !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(body.requestId)) throw authError(400, 'INVALID_INPUT', 'A UUID requestId is required.');
  if (!['paid', 'failed'].includes(body.outcome)) throw authError(400, 'INVALID_INPUT', 'Choose paid or failed simulation outcome.');
  return { reservationId: Number(body.reservationId), requestId: body.requestId.toLowerCase(), outcome: body.outcome };
}
export async function simulatePayment(database, userId, input) {
  return withReservationLock(database, input.reservationId, userId, async (connection, reservation) => {
    let payment = await readPayment(connection, reservation.id);
    if (payment) {
      const [[attempt]] = await connection.execute('SELECT outcome FROM payment_attempts WHERE payment_id = ? AND request_id = ?', [payment.id, input.requestId]);
      if (attempt) {
        if (attempt.outcome !== input.outcome) throw authError(409, 'REQUEST_REUSED', 'This request ID was already used for another outcome.');
        return { payment, replayed: true };
      }
      if (payment.status === 'paid' && input.outcome === 'paid') return { payment, replayed: true };
      if (['paid', 'refunded'].includes(payment.status)) throw authError(409, 'PAYMENT_FINALIZED', 'This payment cannot be attempted again.');
    }
    if (reservation.status !== 'pending' || reservation.start_date < businessToday()) throw authError(409, 'CANNOT_PAY', 'Only pending reservations before or on the pickup day can be paid.');
    const [[snapshot]] = await connection.execute('SELECT total_amount, currency FROM reservation_prices WHERE reservation_id = ?', [reservation.id]);
    if (!snapshot) throw authError(409, 'PRICING_UNAVAILABLE', 'This earlier reservation has no saved price.');
    if (!payment) {
      await connection.execute('INSERT INTO payments (reservation_id, amount, currency) VALUES (?, ?, ?)', [reservation.id, snapshot.total_amount, snapshot.currency]);
      payment = await readPayment(connection, reservation.id);
    }
    // Amount and currency come exclusively from the immutable reservation snapshot.
    await connection.execute('INSERT INTO payment_attempts (payment_id, request_id, outcome) VALUES (?, ?, ?)', [payment.id, input.requestId, input.outcome]);
    await connection.execute('UPDATE payments SET status = ?, paid_at = IF(? = \'paid\', UTC_TIMESTAMP(), NULL) WHERE id = ?', [input.outcome, input.outcome, payment.id]);
    if (input.outcome === 'paid') await connection.execute("UPDATE reservations SET status = 'confirmed' WHERE id = ?", [reservation.id]);
    return { payment: await readPayment(connection, reservation.id), replayed: false };
  });
}
export async function reverseLoyalty(connection, reservationId) {
  const [[earned]] = await connection.execute("SELECT CAST(points_delta AS CHAR) AS points FROM loyalty_transactions WHERE reservation_id = ? AND reason = 'earned'", [reservationId]);
  if (!earned) return;
  const [[reversed]] = await connection.execute("SELECT id FROM loyalty_transactions WHERE reservation_id = ? AND reason = 'reversed'", [reservationId]);
  if (!reversed) await connection.execute("INSERT INTO loyalty_transactions (reservation_id, points_delta, reason) VALUES (?, ?, 'reversed')", [reservationId, (-BigInt(earned.points)).toString()]);
}
export async function refundWithinTransaction(connection, reservationId) {
  await connection.execute("UPDATE payments SET status = 'refunded', refunded_at = UTC_TIMESTAMP() WHERE reservation_id = ? AND status = 'paid'", [reservationId]);
  await connection.execute("UPDATE payments SET status = 'failed' WHERE reservation_id = ? AND status = 'pending'", [reservationId]);
  await reverseLoyalty(connection, reservationId);
}
export async function completeRental(database, userId, reservationId) {
  return withReservationLock(database, reservationId, userId, async (connection, reservation) => {
    const payment = await readPayment(connection, reservationId);
    if (!['confirmed', 'completed'].includes(reservation.status) || reservation.end_date > businessToday() || payment?.status !== 'paid') throw authError(409, 'CANNOT_COMPLETE', 'Only paid rentals on or after their return date can be completed.');
    const [[earned]] = await connection.execute("SELECT id FROM loyalty_transactions WHERE reservation_id = ? AND reason = 'earned'", [reservationId]);
    if (!earned) await connection.execute("INSERT INTO loyalty_transactions (reservation_id, points_delta, reason) VALUES (?, ?, 'earned')", [reservationId, pointsForAmount(payment.amount)]);
    await connection.execute("UPDATE reservations SET status = 'completed' WHERE id = ?", [reservationId]);
    return { reservationId, status: 'completed', pointsEarned: pointsForAmount(payment.amount) };
  });
}
export async function refundPayment(database, paymentId) {
  const [[payment]] = await database.execute('SELECT reservation_id FROM payments WHERE id = ?', [paymentId]);
  if (!payment) throw authError(404, 'PAYMENT_NOT_FOUND', 'Payment not found.');
  return withReservationLock(database, payment.reservation_id, null, async (connection, reservation) => {
    const current = await readPayment(connection, reservation.id);
    if (current.status === 'refunded') return { payment: current };
    if (current.status !== 'paid') throw authError(409, 'CANNOT_REFUND', 'Only paid payments can be refunded.');
    await refundWithinTransaction(connection, reservation.id);
    // Completed remains historical; an active reservation is cancelled to release availability.
    if (reservation.status !== 'completed') await connection.execute("UPDATE reservations SET status = 'cancelled' WHERE id = ?", [reservation.id]);
    return { payment: await readPayment(connection, reservation.id) };
  });
}
export async function listPayments(database, userId, { page, pageSize }) {
  const [[count]] = await database.execute('SELECT COUNT(*) AS total FROM payments p JOIN reservations r ON r.id = p.reservation_id WHERE r.user_id = ?', [userId]);
  const [rows] = await database.execute(`SELECT ${paymentFields}, c.brand, c.model, r.status AS reservation_status,
    (SELECT COUNT(*) FROM payment_attempts a WHERE a.payment_id = p.id) AS attempt_count
    FROM payments p JOIN reservations r ON r.id = p.reservation_id JOIN cars c ON c.id = r.car_id
    WHERE r.user_id = ? ORDER BY p.id DESC LIMIT ? OFFSET ?`, [userId, String(pageSize), String((page - 1) * pageSize)]);
  return { items: rows.map(row => ({ ...paymentValue(row), carName: `${row.brand} ${row.model}`, reservationStatus: row.reservation_status, attemptCount: row.attempt_count })), total: count.total, page, pageSize };
}
export async function loyaltySummary(database, userId, { page, pageSize }) {
  const connection = await database.getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.beginTransaction();
    const [[summary]] = await connection.execute(`SELECT CAST(COALESCE(SUM(l.points_delta), 0) AS CHAR) AS balance, COUNT(*) AS total
      FROM loyalty_transactions l JOIN reservations r ON r.id = l.reservation_id WHERE r.user_id = ?`, [userId]);
    const [rows] = await connection.execute(`SELECT l.id, l.reservation_id, CAST(l.points_delta AS CHAR) AS points_delta, l.reason,
      DATE_FORMAT(l.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at FROM loyalty_transactions l
      JOIN reservations r ON r.id = l.reservation_id WHERE r.user_id = ? ORDER BY l.id DESC LIMIT ? OFFSET ?`, [userId, String(pageSize), String((page - 1) * pageSize)]);
    await connection.commit();
    return { balance: summary.balance, total: summary.total, page, pageSize, items: rows.map(row => ({ id: row.id, reservationId: row.reservation_id, pointsDelta: row.points_delta, reason: row.reason, createdAt: row.created_at })) };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
