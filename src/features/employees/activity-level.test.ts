import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activityLevel } from './activity-level.ts';

test('a zero or absent count is the empty band whatever the largest group is', () => {
  assert.equal(activityLevel(0, 0), 'none');
  assert.equal(activityLevel(0, 12), 'none');
  assert.equal(activityLevel(-3, 12), 'none');
  assert.equal(activityLevel(Number.NaN, 12), 'none');
});

test('bands are relative to the largest group in the same report', () => {
  assert.equal(activityLevel(12, 12), 'high');
  assert.equal(activityLevel(8, 12), 'high');
  assert.equal(activityLevel(7, 12), 'medium');
  assert.equal(activityLevel(4, 12), 'medium');
  assert.equal(activityLevel(3, 12), 'low');
  assert.equal(activityLevel(1, 12), 'low');
});

test('a tied largest group stays in the top band and a missing scale stays empty', () => {
  assert.equal(activityLevel(5, 5), 'high');
  assert.equal(activityLevel(1, 0), 'none');
  assert.equal(activityLevel(1, Number.NaN), 'none');
  // A defensive count above the scale is still the top band, never an out-of-range level.
  assert.equal(activityLevel(9, 5), 'high');
});
