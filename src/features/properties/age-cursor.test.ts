import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ageCursorArgs,
  decodeAgeCursor,
  encodeAgeCursor,
  inventoryPage,
  isInventoryOrder,
  validTrailToken,
} from './age-cursor.ts';

const id = '11111111-1111-4111-8111-111111111111';

test('a known entry date encodes a date+identity cursor and an unknown one its identity', () => {
  assert.equal(
    encodeAgeCursor({ entryOn: '2025-06-01', id }),
    `d:2025-06-01:${id}`,
  );
  assert.equal(encodeAgeCursor({ entryOn: null, id }), `u:${id}`);
});

test('cursor tokens round-trip through the same key the database ordered by', () => {
  for (const row of [
    { entryOn: '2023-02-03', id },
    { entryOn: null, id },
  ]) {
    const decoded = decodeAgeCursor(encodeAgeCursor(row));
    assert.ok(decoded.ok);
    assert.deepEqual(
      decoded.cursor,
      row.entryOn ? { date: row.entryOn, id } : { unknown: true, id },
    );
  }
});

test('an absent cursor is the first page and a malformed one is refused', () => {
  for (const value of [null, undefined, ''])
    assert.deepEqual(decodeAgeCursor(value), { ok: true, cursor: null });
  for (const value of [
    'x',
    `d:2025-6-1:${id}`,
    `d:2025-13-01:${id}`,
    `d:2025-02-30:${id}`,
    `d:2025-06-01:not-a-uuid`,
    `u:not-a-uuid`,
    `d:2025-06-01:${id}:extra`,
    `u:${id}:extra`,
    `2025-06-01:${id}`,
  ]) {
    const decoded = decodeAgeCursor(value);
    assert.equal(decoded.ok, false, `${value} must be refused`);
  }
});

test('decoded cursors become the date+identity or unknown-section arguments', () => {
  assert.deepEqual(ageCursorArgs(null), {});
  assert.deepEqual(ageCursorArgs({ date: '2025-06-01', id }), {
    p_after_on: '2025-06-01',
    p_after_id: id,
  });
  assert.deepEqual(ageCursorArgs({ unknown: true, id }), {
    p_after_unknown: true,
    p_after_id: id,
  });
});

test('the trail validates tokens against the active ordering only', () => {
  assert.equal(validTrailToken(null, '~'), true);
  assert.equal(validTrailToken('oldest', '~'), true);
  assert.equal(validTrailToken(null, id), true);
  assert.equal(validTrailToken(null, `d:2025-06-01:${id}`), false);
  assert.equal(validTrailToken('oldest', `d:2025-06-01:${id}`), true);
  assert.equal(validTrailToken('newest', `u:${id}`), true);
  assert.equal(validTrailToken('oldest', 'nonsense'), false);
});

test('a page links forward only when a lookahead row proves another page exists', () => {
  const rows = Array.from({ length: 31 }, (_, index) => index);
  const full = inventoryPage(rows);
  assert.equal(full.page.length, 30);
  assert.equal(full.hasMore, true);
  const exact = inventoryPage(rows.slice(0, 30));
  assert.equal(exact.page.length, 30);
  assert.equal(exact.hasMore, false);
  const partial = inventoryPage(rows.slice(0, 29));
  assert.equal(partial.page.length, 29);
  assert.equal(partial.hasMore, false);
  const empty = inventoryPage([]);
  assert.equal(empty.page.length, 0);
  assert.equal(empty.hasMore, false);
});

test('only the two chronological orderings are accepted', () => {
  assert.equal(isInventoryOrder('oldest'), true);
  assert.equal(isInventoryOrder('newest'), true);
  for (const value of ['', 'asc', 'desc', 'OLDEST', null, undefined])
    assert.equal(isInventoryOrder(value), false);
});
