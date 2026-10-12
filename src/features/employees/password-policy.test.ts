import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluatePassword,
  passwordRules,
  strengthLabelKey,
} from './password-policy.ts';

// Illustrative passwords are assembled at runtime rather than written as
// literals, so the repository never contains a credential-shaped string that
// secret scanners would flag.
function sample(counts: {
  lower?: number;
  upper?: number;
  digit?: number;
  symbol?: number;
}): string {
  return (
    'a'.repeat(counts.lower ?? 0) +
    'A'.repeat(counts.upper ?? 0) +
    '0'.repeat(counts.digit ?? 0) +
    '!'.repeat(counts.symbol ?? 0)
  );
}

test('all four canonical rules are declared', () => {
  assert.deepEqual(
    passwordRules.map((rule) => rule.key),
    ['len', 'case', 'digit', 'symbol'],
  );
});

test('an empty password is level 0 with no verdict', () => {
  const evaluation = evaluatePassword('');
  assert.equal(evaluation.level, 0);
  assert.equal(evaluation.metCount, 0);
  assert.equal(strengthLabelKey(evaluation.level), null);
});

test('each rule is measured independently', () => {
  // Ten lower-case characters satisfy only the length rule.
  assert.deepEqual(evaluatePassword(sample({ lower: 10 })).met, {
    len: true,
    case: false,
    digit: false,
    symbol: false,
  });
  // Add an upper-case character.
  assert.deepEqual(evaluatePassword(sample({ lower: 9, upper: 1 })).met, {
    len: true,
    case: true,
    digit: false,
    symbol: false,
  });
  // Add a digit.
  assert.deepEqual(
    evaluatePassword(sample({ lower: 9, upper: 1, digit: 1 })).met,
    { len: true, case: true, digit: true, symbol: false },
  );
  // Add a symbol → all four.
  assert.deepEqual(
    evaluatePassword(sample({ lower: 9, upper: 1, digit: 1, symbol: 1 })).met,
    { len: true, case: true, digit: true, symbol: true },
  );
});

test('levels follow the reference meter (met count → 1..4)', () => {
  assert.equal(evaluatePassword(sample({ lower: 3 })).level, 1);
  assert.equal(evaluatePassword(sample({ lower: 10, digit: 1 })).level, 2);
  assert.equal(
    evaluatePassword(sample({ lower: 9, upper: 1, digit: 1 })).level,
    3,
  );
  assert.equal(
    evaluatePassword(sample({ lower: 9, upper: 1, digit: 1, symbol: 1 })).level,
    4,
  );
});

test('a nine-character password fails the length rule even with case/digit/symbol', () => {
  // Stricter than the backend's 8-character minimum; the UI never weakens it.
  const evaluation = evaluatePassword(
    sample({ lower: 6, upper: 1, digit: 1, symbol: 1 }),
  );
  assert.equal(evaluation.met.len, false);
  assert.equal(evaluation.metCount, 3);
});

test('verdict label keys map to the four strength labels', () => {
  assert.equal(strengthLabelKey(1), 'strengthWeak');
  assert.equal(strengthLabelKey(2), 'strengthFair');
  assert.equal(strengthLabelKey(3), 'strengthGood');
  assert.equal(strengthLabelKey(4), 'strengthStrong');
});
