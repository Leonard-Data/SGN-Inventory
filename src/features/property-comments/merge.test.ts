import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeComments } from './merge.ts';
import type { Comment } from './types.ts';

const row = (id: string, body = id): Comment => ({
  id,
  propertyId: '11111111-1111-4111-8111-111111111111',
  authorId: '22222222-2222-4222-8222-222222222222',
  authorName: 'Fixture',
  body,
  createdAt: '2026-10-12T00:00:00Z',
  revision: '33333333-3333-4333-8333-333333333333',
  editedAt: null,
});

test('a conflict refresh keeps an already-loaded older row and lets the newest page win', () => {
  const refreshed = [row('a', 'newest a'), row('b')];
  const loaded = [row('a', 'stale a'), row('c'), row('d')];
  assert.deepEqual(
    mergeComments(refreshed, loaded).map((entry) => [entry.id, entry.body]),
    [
      ['a', 'newest a'],
      ['b', 'b'],
      ['c', 'c'],
      ['d', 'd'],
    ],
  );
});

test('a refresh with no loaded rows returns the page unchanged', () => {
  const refreshed = [row('a'), row('b')];
  assert.deepEqual(mergeComments(refreshed, []), refreshed);
});
