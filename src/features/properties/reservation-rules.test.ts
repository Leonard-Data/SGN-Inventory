import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decisionDays,
  lockStateMoved,
  reservationReason,
} from './reservation-rules.ts';

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

test('a lost lock refreshes the property from server state', () => {
  // The database refused the lock because the committed state moved on: a competing reservation
  // won, the property is no longer requestable, or the lock was already closed. Each of these
  // re-reads the property's current state instead of leaving the browser's copy on screen.
  assert.equal(lockStateMoved('reservation-conflict'), true);
  assert.equal(lockStateMoved('reservation-unavailable'), true);
  assert.equal(lockStateMoved('reservation-closed'), true);
  // Every other refusal is reported as it is: nothing about the property's state changed.
  assert.equal(lockStateMoved('self-approval-forbidden'), false);
  assert.equal(lockStateMoved('invalid-input'), false);
  assert.equal(lockStateMoved('not-found'), false);
  assert.equal(lockStateMoved('unavailable'), false);
});
