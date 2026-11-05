import test from 'node:test';
import assert from 'node:assert/strict';
import { pointsForAmount } from '../src/services/payments.js';
test('points use whole hundreds of TRY and exact integer arithmetic', () => {
  for (const [amount, expected] of [['0.00', '0'], ['99.99', '0'], ['100.00', '1'], ['199.99', '1'], ['12345.60', '123'], ['999999999999999999.99', '9999999999999999']]) assert.equal(pointsForAmount(amount), expected);
});
