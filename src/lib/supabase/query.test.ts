import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cursorPair, isUuid } from './query.ts';

const before = '2026-10-13T10:00:00.000000Z';
const beforeId = '10000000-0000-4000-8000-000000000001';

const params = (query: string) => new URLSearchParams(query);

test('no cursor parameters is the first page, not an invalid cursor', () => {
  assert.equal(cursorPair(params('')), null);
  assert.equal(cursorPair(params('series=sale')), null);
});

test('a complete well-formed cursor is accepted as both parts', () => {
  assert.deepEqual(
    cursorPair(
      params(`before=${encodeURIComponent(before)}&beforeId=${beforeId}`),
    ),
    { before, beforeId },
  );
});

test('a blank or partial cursor pair is invalid, never the first page', () => {
  for (const query of [
    'before=&beforeId=',
    'before=&beforeId=' + beforeId,
    'before=' + encodeURIComponent(before) + '&beforeId=',
    'before=&series=sale',
    'beforeId=&series=sale',
    'before=',
    'beforeId=',
    'before=' + encodeURIComponent(before),
    'beforeId=' + beforeId,
  ])
    assert.equal(cursorPair(params(query)), 'invalid', query);
});

test('a cursor part that is not a timestamp/UUID pair is invalid', () => {
  for (const query of [
    'before=not-a-time&beforeId=' + beforeId,
    'before=' +
      encodeURIComponent('2026-10-13T10:00:00+07:00') +
      '&beforeId=' +
      beforeId,
    'before=' + encodeURIComponent(before) + '&beforeId=not-a-uuid',
  ])
    assert.equal(cursorPair(params(query)), 'invalid', query);
});

test('UUID recognition stays exact', () => {
  assert.equal(isUuid(beforeId), true);
  assert.equal(isUuid(beforeId.toUpperCase()), true);
  assert.equal(isUuid(beforeId.replace(/.$/, '')), false);
  assert.equal(isUuid(null), false);
});
