import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrice } from '../src/services/reservations.js';

test('price calculation uses calendar days and exact cents across leap day', () => {
  assert.deepEqual(calculatePrice('1234.56', { startDate: '2032-02-28', endDate: '2032-03-01' }), { dailyPrice: '1234.56', rentalDays: 2, totalAmount: '2469.12', currency: 'TRY' });
  assert.equal(calculatePrice('0.01', { startDate: '2030-01-01', endDate: '2030-01-04' }).totalAmount, '0.03');
  assert.equal(calculatePrice('0.00', { startDate: '2030-01-01', endDate: '2030-01-02' }).totalAmount, '0.00');
});
test('maximum supported rate and long rental preserve exact cents beyond Number precision', () => {
  const quote = calculatePrice('9999999999.99', { startDate: '2030-01-01', endDate: '9999-12-31' });
  assert.ok(BigInt(quote.totalAmount.replace('.', '')) > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(BigInt(quote.totalAmount.replace('.', '')), 999999999999n * BigInt(quote.rentalDays));
});
