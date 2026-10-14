import assert from 'node:assert/strict';
import test from 'node:test';
import { completionDate, completionReference } from './rules.ts';

test('a completion date is a real YYYY-MM-DD calendar date', () => {
  assert.equal(completionDate('2026-10-14'), '2026-10-14');
  assert.equal(completionDate('2026-02-28'), '2026-02-28');
  assert.equal(completionDate('2026-02-30'), null);
  assert.equal(completionDate('2026-2-3'), null);
  assert.equal(completionDate('14/10/2026'), null);
  assert.equal(completionDate('2026-10-14T00:00:00Z'), null);
  assert.equal(completionDate(''), null);
  assert.equal(completionDate(20261014), null);
  assert.equal(completionDate(null), null);
});

test('a contract reference keeps source text within the database bounds', () => {
  assert.equal(completionReference('  HĐ-38/2026  '), 'HĐ-38/2026');
  assert.equal(completionReference('a'), 'a');
  assert.equal(completionReference('a'.repeat(200)), 'a'.repeat(200));
  assert.equal(completionReference('a'.repeat(201)), null);
  assert.equal(completionReference('   '), null);
  assert.equal(completionReference(''), null);
  assert.equal(completionReference(38), null);
  assert.equal(completionReference(null), null);
});
