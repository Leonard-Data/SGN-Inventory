import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergePage,
  mergePageKeepingComment,
} from './discussion-state.ts';
import type { Comment } from './types.ts';

function comment(id: string, body: string, createdAt: string): Comment {
  return {
    id,
    propertyId: '11111111-1111-1111-1111-111111111111',
    authorId: '22222222-2222-2222-2222-222222222222',
    authorName: 'Nguyen An',
    body,
    createdAt,
    revision: id + '-revision',
    removedAt: null,
    editedAt: null,
  };
}

test('stale edit refresh keeps an older-page edited row visible', () => {
  const newest = comment('newest', 'Newest', '2026-10-13T09:00:00.000Z');
  const older = comment('older', 'Draft owner', '2026-10-12T09:00:00.000Z');
  const refreshedNewest = {
    ...newest,
    body: 'Newest refreshed',
    revision: 'newest-revision-2',
  };

  assert.deepEqual(
    mergePageKeepingComment([newest, older], [refreshedNewest], older.id),
    [refreshedNewest, older],
  );
});

test('ordinary page refresh still follows the refreshed page contents', () => {
  const newest = comment('newest', 'Newest', '2026-10-13T09:00:00.000Z');
  const older = comment('older', 'Older', '2026-10-12T09:00:00.000Z');

  assert.deepEqual(mergePage([newest, older], [newest]), [newest]);
});
