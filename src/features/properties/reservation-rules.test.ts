import assert from 'node:assert/strict';
import test from 'node:test';
import { decisionDays, reservationReason } from './reservation-rules.ts';

test('a reservation reason keeps source text within the database bounds', () => {
  assert.equal(
    reservationReason('  Khách đã đồng ý giá, chờ quản lý duyệt  '),
    'Khách đã đồng ý giá, chờ quản lý duyệt',
  );
  assert.equal(reservationReason('a'.repeat(10)), 'a'.repeat(10));
  assert.equal(reservationReason('a'.repeat(2000)), 'a'.repeat(2000));
  assert.equal(reservationReason('  ngắn  '), null);
  assert.equal(reservationReason('a'.repeat(2001)), null);
  assert.equal(reservationReason(''), null);
  assert.equal(reservationReason('          '), null);
  assert.equal(reservationReason(7), null);
  assert.equal(reservationReason(null), null);
});

test('decision days are whole numbers inside 1-30', () => {
  assert.equal(decisionDays(1), 1);
  assert.equal(decisionDays(30), 30);
  assert.equal(decisionDays(7), 7);
  assert.equal(decisionDays(0), null);
  assert.equal(decisionDays(31), null);
  assert.equal(decisionDays(7.5), null);
  assert.equal(decisionDays('7'), null);
  assert.equal(decisionDays(null), null);
});
