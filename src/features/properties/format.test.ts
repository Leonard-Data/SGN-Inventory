import assert from 'node:assert/strict';
import test from 'node:test';
import { formatVnd, vietnamDate } from './format.ts';

test('whole VND remains exact beyond JavaScript safe integer precision', () => {
  assert.equal(
    formatVnd('9007199254740993', 'vi'),
    '9.007.199.254.740.993 VND',
  );
  assert.equal(
    formatVnd('9007199254740993', 'en'),
    '9,007,199,254,740,993 VND',
  );
  assert.equal(
    formatVnd('999999999999999999', 'en'),
    '999,999,999,999,999,999 VND',
  );
  assert.equal(formatVnd('0', 'vi'), '0 VND');
});
test('money rejects noncanonical decimal and scientific notation', () => {
  for (const value of ['1.5', '1e3', '-1', ''])
    assert.throws(() => formatVnd(value, 'en'));
});
test('Vietnam dates cross midnight at UTC 17:00 regardless of the device zone', () => {
  assert.equal(vietnamDate('2026-10-09T16:59:59Z'), '09/10/2026');
  assert.equal(vietnamDate('2026-10-09T17:00:00Z'), '10/10/2026');
});
