import { businessToday } from '../services/availability.js';
import { emailValue, passwordValue, hashPassword, verifyPassword } from '../services/auth.js';
import { calculatePrice } from '../services/reservations.js';
import { pointsForAmount } from '../services/payments.js';

const codes = ['P8-DEMO-AVAILABLE', 'P8-DEMO-RESERVED', 'P8-DEMO-MAINT'];
const shift = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
export async function seedDemo(database, { password, customerEmail = 'demo.customer@example.test', adminEmail = 'demo.admin@example.test' } = {}) {
  if (!['development', 'test'].includes(process.env.NODE_ENV)) throw new Error('Demo seed requires NODE_ENV=development or test');
  passwordValue(password); customerEmail = emailValue(customerEmail); adminEmail = emailValue(adminEmail);
  if (customerEmail === adminEmail) throw new Error('Demo customer and admin emails must be different');
  const connection = await database.getConnection();
  let locked = false;
  try {
    const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 30) AS acquired', ['smartrent_demo_seed']);
    if (Number(lock.acquired) !== 1) throw new Error('Demo seed lock unavailable');
    locked = true; await connection.beginTransaction();
    const [users] = await connection.execute('SELECT id, email, role, password_hash FROM users WHERE email IN (?, ?)', [customerEmail, adminEmail]);
    const [cars] = await connection.execute('SELECT id, vehicle_code FROM cars WHERE vehicle_code IN (?, ?, ?)', codes);
    let customerId, adminId, carIds, created = false;
    if (users.length || cars.length) {
      const customer = users.find(user => user.email === customerEmail && user.role === 'customer');
      const admin = users.find(user => user.email === adminEmail && user.role === 'admin');
      if (users.length !== 2 || cars.length !== 3 || !customer || !admin || !await verifyPassword(password, customer.password_hash) || !await verifyPassword(password, admin.password_hash)) {
        throw new Error('Demo email/code collision or different credentials; no accounts or records changed');
      }
      customerId = customer.id; adminId = admin.id;
      carIds = codes.map(code => cars.find(car => car.vehicle_code === code).id);
      const [[history]] = await connection.execute('SELECT COUNT(*) AS total FROM reservations WHERE user_id = ? AND car_id IN (?, ?)', [customerId, carIds[0], carIds[1]]);
      if (history.total < 4) throw new Error('Incomplete demo dataset; no accounts or records changed');
    } else {
      const [customerHash, adminHash] = await Promise.all([hashPassword(password), hashPassword(password)]);
      const [customer] = await connection.execute("INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, 'Demo Customer')", [customerEmail, customerHash]);
      const [admin] = await connection.execute("INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, 'Demo Administrator', 'admin')", [adminEmail, adminHash]);
      customerId = customer.insertId; adminId = admin.insertId; carIds = [];
      for (const [index, code] of codes.entries()) {
        const [car] = await connection.execute(`INSERT INTO cars (vehicle_code, brand, model, category, seats, transmission, fuel_type, daily_price, status)
          VALUES (?, 'SmartRent Demo', ?, 'economy', 5, 'automatic', 'hybrid', ?, ?)`, [code, ['Daytrip', 'Reserved', 'Workshop'][index], index === 1 ? '1200.00' : '1000.00', index === 2 ? 'maintenance' : 'active']);
        carIds.push(car.insertId);
      }
      const today = businessToday();
      // Synthetic history is confined to this guarded, explicit development command.
      for (const scenario of [
        { carId: carIds[0], startDate: shift(today, -7), endDate: shift(today, -5), status: 'completed', payment: 'paid', daily: '1000.00', points: true },
        { carId: carIds[0], startDate: shift(today, -12), endDate: shift(today, -10), status: 'completed', payment: 'refunded', daily: '1000.00', points: true },
        { carId: carIds[0], startDate: shift(today, -3), endDate: shift(today, -1), status: 'confirmed', payment: 'paid', daily: '1000.00', points: false },
        { carId: carIds[1], startDate: shift(today, 2), endDate: shift(today, 5), status: 'pending', payment: 'pending', daily: '1200.00', points: false },
      ]) {
        const pricing = calculatePrice(scenario.daily, scenario);
        const [reservation] = await connection.execute('INSERT INTO reservations (user_id, car_id, start_date, end_date, status) VALUES (?, ?, ?, ?, ?)', [customerId, scenario.carId, scenario.startDate, scenario.endDate, scenario.status]);
        const id = reservation.insertId;
        await connection.execute('INSERT INTO reservation_prices (reservation_id, daily_price, rental_days, total_amount) VALUES (?, ?, ?, ?)', [id, pricing.dailyPrice, pricing.rentalDays, pricing.totalAmount]);
        const [payment] = await connection.execute(`INSERT INTO payments (reservation_id, amount, status, paid_at, refunded_at)
          VALUES (?, ?, ?, IF(? <> 'pending', UTC_TIMESTAMP(), NULL), IF(? = 'refunded', UTC_TIMESTAMP(), NULL))`, [id, pricing.totalAmount, scenario.payment, scenario.payment, scenario.payment]);
        if (scenario.payment !== 'pending') await connection.execute("INSERT INTO payment_attempts (payment_id, request_id, outcome) VALUES (?, UUID(), 'paid')", [payment.insertId]);
        if (scenario.points) {
          const points = pointsForAmount(pricing.totalAmount);
          await connection.execute("INSERT INTO loyalty_transactions (reservation_id, points_delta, reason) VALUES (?, ?, 'earned')", [id, points]);
          if (scenario.payment === 'refunded') await connection.execute("INSERT INTO loyalty_transactions (reservation_id, points_delta, reason) VALUES (?, ?, 'reversed')", [id, (-BigInt(points)).toString()]);
        }
      }
      created = true;
    }
    const [reservations] = await connection.execute("SELECT id, car_id AS carId, status, DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate, DATE_FORMAT(end_date, '%Y-%m-%d') AS endDate FROM reservations WHERE user_id = ? AND car_id IN (?, ?) ORDER BY id", [customerId, carIds[0], carIds[1]]);
    await connection.commit();
    return { created, customerEmail, adminEmail, customerId, adminId, cars: Object.fromEntries(codes.map((code, index) => [code, carIds[index]])), reservations };
  } catch (error) { await connection.rollback(); throw error; }
  finally {
    try { if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', ['smartrent_demo_seed']); }
    finally { connection.release(); }
  }
}
