import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatVnd,
  compactVnd,
  formatDecimal,
  formatInteger,
  RELATIVE_DAYS,
  relativeTime,
  vietnamDate,
  vietnamTimestamp,
  unitHierarchy,
  dialableNumber,
} from './format.ts';

test('the recorded hierarchy reads largest tier first, without a tier it does not carry', () => {
  // The official names sit beside the recorded text in the order the record states: province,
  // district, ward. A level the address did not record contributes nothing, so the line never
  // claims a tier - and never rebuilds one - from the source text.
  assert.equal(
    unitHierarchy(['Thành phố Hồ Chí Minh', 'Quận Bình Thạnh', 'Phường 22']),
    'Thành phố Hồ Chí Minh · Quận Bình Thạnh · Phường 22',
  );
  assert.equal(
    unitHierarchy(['Thành phố Hồ Chí Minh', null, 'Phường Thạnh Mỹ Tây']),
    'Thành phố Hồ Chí Minh · Phường Thạnh Mỹ Tây',
  );
  assert.equal(unitHierarchy([undefined, null, '']), '');
});

test('compact VND retains every digit and localizes only the presentation', () => {
  assert.equal(compactVnd('25000000000', 'vi'), '25 tỷ ₫');
  assert.equal(compactVnd('25000000001', 'vi'), '25,000000001 tỷ ₫');
  assert.equal(compactVnd('1250000', 'en'), '1.25m ₫');
  assert.equal(compactVnd('0', 'vi'), '0 ₫');
  assert.equal(compactVnd('9007199254740993', 'en'), '9,007,199.254740993bn ₫');
  assert.throws(() => compactVnd('1e9', 'vi'));
});

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
  assert.equal(formatInteger(1299, 'vi'), '1.299');
  assert.equal(formatInteger(0, 'en'), '0');
  const stamp = vietnamTimestamp('2026-10-09T17:05:00Z', 'en');
  assert.ok(stamp);
  assert.match(stamp, /10\/10\/2026.*00:05/);
});
test('an absent or unparseable recorded date reports no value instead of throwing', () => {
  // A nullable recorded date (an address with no effective date, an imported row)
  // must reach the unknown marker, not crash the page that renders it.
  for (const value of [null, undefined, '', 'not a date'])
    assert.equal(vietnamDate(value), null);
  assert.equal(vietnamTimestamp(null, 'vi'), null);
  assert.equal(vietnamTimestamp('', 'en'), null);
  assert.equal(vietnamDate('2026-10-09'), '09/10/2026');
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
// The modified column reads as how long ago a record changed. Each phrase owns one band, and
// the band is entered at its own boundary, so the cell never says "60 minutes ago" on a record
// that changed an hour ago.
const changed = '2026-09-20T09:30:00Z';
const at = Date.parse(changed);
const ago = (ms: number, locale: 'vi' | 'en' = 'vi') =>
  relativeTime(changed, locale, at + ms)!.text;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test('each relative phrase starts and ends at its own boundary', () => {
  assert.equal(ago(0), 'vừa xong');
  assert.equal(ago(MINUTE - SECOND), 'vừa xong');
  assert.equal(ago(MINUTE), '1 phút trước');
  assert.equal(ago(2 * MINUTE), '2 phút trước');
  assert.equal(ago(HOUR - SECOND), '59 phút trước');
  assert.equal(ago(HOUR), '1 giờ trước');
  assert.equal(ago(DAY - SECOND), '23 giờ trước');
  assert.equal(ago(DAY), '1 ngày trước');
  assert.equal(ago(2 * DAY), '2 ngày trước');
  assert.equal(ago(RELATIVE_DAYS * DAY - SECOND), '6 ngày trước');
});

test('the same boundaries read in English, with one phrase for one unit', () => {
  assert.equal(ago(0, 'en'), 'just now');
  assert.equal(ago(MINUTE, 'en'), '1 minute ago');
  assert.equal(ago(90 * MINUTE, 'en'), '1 hour ago');
  assert.equal(ago(DAY, 'en'), '1 day ago');
  assert.equal(ago(3 * DAY, 'en'), '3 days ago');
});

test('a value old enough to lose the phrase states its recorded date instead', () => {
  // `RELATIVE_DAYS` is the threshold: a week of "ago" is still placeable, "9 days ago" is not.
  assert.equal(RELATIVE_DAYS, 7);
  assert.equal(ago(RELATIVE_DAYS * DAY), vietnamDate(changed));
  assert.equal(ago(400 * DAY), vietnamDate(changed));
  // A stamp recorded in the future is not "in 3 minutes": it states the recorded day.
  assert.equal(ago(-MINUTE), vietnamDate(changed));
});

test('the exact recorded timestamp is kept whatever the cell reads', () => {
  const exact = vietnamTimestamp(changed, 'vi')!;
  // Both the phrase and the date fallback carry it.
  assert.deepEqual(relativeTime(changed, 'vi', at + MINUTE), {
    text: '1 phút trước',
    exact,
  });
  assert.deepEqual(relativeTime(changed, 'vi', at + 40 * DAY), {
    text: vietnamDate(changed),
    exact,
  });
  // Before the page has hydrated there is no browser clock to phrase from, so the cell states
  // the recorded timestamp itself instead of a phrase the server and the browser would disagree
  // about.
  assert.deepEqual(relativeTime(changed, 'vi', null), { text: exact, exact });
  assert.deepEqual(relativeTime(changed, 'en', null), {
    text: vietnamTimestamp(changed, 'en'),
    exact: vietnamTimestamp(changed, 'en'),
  });
});

test('an absent or unparseable modified time reports no value', () => {
  for (const value of [null, undefined, '', 'not a date'])
    assert.equal(relativeTime(value, 'vi', at), null);
});
