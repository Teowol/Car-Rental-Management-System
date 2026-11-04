import test from 'node:test';
import assert from 'node:assert/strict';
import { businessToday, parseDateRange } from '../src/services/availability.js';

const now = new Date('2030-01-01T12:00:00Z');
const parse = query => parseDateRange(query, { now });
test('rental calendar uses Istanbul midnight regardless of server timezone', () => {
  assert.equal(businessToday(new Date('2030-01-01T20:59:59Z')), '2030-01-01');
  assert.equal(businessToday(new Date('2030-01-01T21:00:00Z')), '2030-01-02');
  assert.throws(() => parseDateRange({ startDate: '2030-01-01', endDate: '2030-01-03' }, { now: new Date('2030-01-01T21:00:00Z') }), /past/);
});
test('date validation accepts today, leap days and one-day intervals', () => {
  assert.deepEqual(parse({ startDate: '2030-01-01', endDate: '2030-01-02' }), { startDate: '2030-01-01', endDate: '2030-01-02' });
  assert.equal(parse({ startDate: '2032-02-29', endDate: '2032-03-01' }).startDate, '2032-02-29');
});
test('invalid calendar dates, reversed/empty intervals, past dates and repeated input fail', () => {
  for (const query of [
    {}, { startDate: '2030-01-01' }, { startDate: '2030-02-29', endDate: '2030-03-01' },
    { startDate: '2030-04-31', endDate: '2030-05-02' }, { startDate: '2030-1-01', endDate: '2030-01-02' },
    { startDate: '2030-01-01T00:00:00Z', endDate: '2030-01-02' },
    { startDate: '2030-01-02', endDate: '2030-01-02' }, { startDate: '2030-01-03', endDate: '2030-01-02' },
    { startDate: '2029-12-31', endDate: '2030-01-02' }, { startDate: ['2030-01-01'], endDate: '2030-01-02' },
    { startDate: '2030-01-01', endDate: '2030-01-02', unknown: '1' },
  ]) assert.throws(() => parse(query), { status: 400 });
});
