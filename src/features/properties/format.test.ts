import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatVnd,
  formatDecimal,
  vietnamDate,
  vietnamTimestamp,
  dialableNumber,
} from './format.ts';

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
test('decimal dimensions remain exact and history instants show Vietnam time', () => {
  assert.equal(formatDecimal('1234567890.50', 'vi'), '1.234.567.890,50');
  assert.equal(formatDecimal('1234567890.50', 'en'), '1,234,567,890.50');
  assert.match(
    vietnamTimestamp('2026-10-09T17:05:00Z', 'en'),
    /10\/10\/2026.*00:05/,
  );
});
test('money rejects noncanonical decimal and scientific notation', () => {
  for (const value of ['1.5', '1e3', '-1', ''])
    assert.throws(() => formatVnd(value, 'en'));
});
test('Vietnam dates cross midnight at UTC 17:00 regardless of the device zone', () => {
  assert.equal(vietnamDate('2026-10-09T16:59:59Z'), '09/10/2026');
  assert.equal(vietnamDate('2026-10-09T17:00:00Z'), '10/10/2026');
});
test('only a single plausible recorded number becomes a Call link', () => {
  assert.equal(dialableNumber('+84 90 123 4567'), '+84901234567');
  assert.equal(dialableNumber('(028) 3822 1234'), '02838221234');
  assert.equal(dialableNumber('12'), null);
  assert.equal(dialableNumber('chưa có số'), null);
  // Masked text and two numbers must never be concatenated into a fabricated dial target.
  assert.equal(dialableNumber('***789'), null);
  assert.equal(dialableNumber('0901234567 - 0341234567'), null);
  assert.equal(dialableNumber('+84900000291 / +84900000292'), null);
  assert.equal(dialableNumber(''), null);
});
