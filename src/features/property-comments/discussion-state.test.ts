import assert from 'node:assert/strict';
import test from 'node:test';
import { mergePage, mergeStaleEditState } from './discussion-state.ts';
import type { Comment } from './types.ts';

function comment(
  id: string,
  body: string | null,
  createdAt: string,
  editedAt: string | null = null,
  removedAt: string | null = null,
): Comment {
  return {
    id,
    propertyId: '11111111-1111-1111-1111-111111111111',
    authorId: '22222222-2222-2222-2222-222222222222',
    authorName: 'Nguyen An',
    body,
    createdAt,
    revision: id + '-revision',
    removedAt,
    editedAt,
  };
}

test('stale edit refresh keeps exact older-page current row visible', () => {
  const newest = comment('newest', 'Newest', '2026-10-13T09:00:00.000Z');
  const older = comment('older', 'Draft owner', '2026-10-12T09:00:00.000Z');
  const refreshedNewest = {
    ...newest,
    body: 'Newest refreshed',
    revision: 'newest-revision-2',
  };
  const currentOlder = {
    ...older,
    body: 'Committed elsewhere',
    revision: 'older-revision-2',
    editedAt: '2026-10-13T10:00:00.000Z',
  };

  assert.deepEqual(
    mergeStaleEditState(
      [newest, older],
      [refreshedNewest],
      older.id,
      currentOlder,
    ),
    [refreshedNewest, currentOlder],
  );
});

test('stale edit refresh keeps removal marker for an older-page row', () => {
  const newest = comment('newest', 'Newest', '2026-10-13T09:00:00.000Z');
  const older = comment('older', 'Draft owner', '2026-10-12T09:00:00.000Z');
  const removedOlder = {
    ...older,
    body: null,
    revision: 'older-revision-2',
    removedAt: '2026-10-13T10:00:00.000Z',
  };

  assert.deepEqual(
    mergeStaleEditState([newest, older], [newest], older.id, removedOlder),
    [newest, removedOlder],
  );
});

test('older in-flight page cannot roll back a newer local edit', () => {
  const latest = comment(
    'edited',
    'Newer edit',
    '2026-10-12T09:00:00.000Z',
    '2026-10-13T10:00:00.000Z',
  );
  const stale = {
    ...latest,
    body: 'Older edit',
    revision: 'edited-revision-older',
    editedAt: '2026-10-13T09:00:00.000Z',
  };

  assert.deepEqual(mergePage([latest], [stale]), [latest]);
});

test('stale edit merge preserves loaded row position', () => {
  const newest = comment('newest', 'Newest', '2026-10-13T09:00:00.000Z');
  const middle = comment('middle', 'Middle', '2026-10-12T09:00:00.000Z');
  const older = comment('older', 'Older', '2026-10-11T09:00:00.000Z');
  const currentOlder = { ...older, body: 'Current older' };

  assert.deepEqual(
    mergeStaleEditState(
      [newest, middle, older],
      [newest],
      older.id,
      currentOlder,
    ),
    [newest, middle, currentOlder],
  );
});

test('ordinary page refresh still follows the refreshed page contents', () => {
  const newest = comment('newest', 'Newest', '2026-10-13T09:00:00.000Z');
  const older = comment('older', 'Older', '2026-10-12T09:00:00.000Z');

  assert.deepEqual(mergePage([newest, older], [newest]), [newest]);
});
