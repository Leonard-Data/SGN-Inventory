import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changedCommentIds,
  droppedCommentIds,
  mergePage,
  mergeStaleEditState,
  retainEditTarget,
  staleHistoryIds,
  withPost,
} from './discussion-state.ts';
import { COMMENT_PAGE_SIZE, type Comment } from './types.ts';

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
    mergeStaleEditState([newest, older], [refreshedNewest], currentOlder),
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
    mergeStaleEditState([newest, older], [newest], removedOlder),
    [newest, removedOlder],
  );
});

test('exact stale read cannot roll back a newer page edit', () => {
  const local = comment('edited', 'Local', '2026-10-12T09:00:00.000Z');
  const page = {
    ...local,
    body: 'Newer page edit',
    revision: 'edited-revision-newer',
    editedAt: '2026-10-13T10:00:00.000Z',
  };
  const exact = {
    ...local,
    body: 'Older exact edit',
    revision: 'edited-revision-older',
    editedAt: '2026-10-13T09:00:00.000Z',
  };

  assert.deepEqual(mergeStaleEditState([local], [page], exact), [page]);
});

test('exact read replaces the matching fresh page row without duplication', () => {
  const page = comment(
    'edited',
    'Page edit',
    '2026-10-12T09:00:00.000Z',
    '2026-10-13T09:00:00.000Z',
  );
  const exact = {
    ...page,
    body: 'Exact newer edit',
    revision: 'edited-revision-exact',
    editedAt: '2026-10-13T10:00:00.000Z',
  };

  assert.deepEqual(mergeStaleEditState([], [page], exact), [exact]);
});

test('exact live read cannot replace a newer page removal marker', () => {
  const local = comment(
    'edited',
    'Local edit',
    '2026-10-12T09:00:00.000Z',
    '2026-10-13T09:00:00.000Z',
  );
  const removed = {
    ...local,
    body: null,
    revision: 'edited-revision-removed',
    removedAt: '2026-10-13T11:00:00.000Z',
  };
  const exact = {
    ...local,
    body: 'Older exact edit',
    revision: 'edited-revision-exact',
    editedAt: '2026-10-13T10:00:00.000Z',
  };

  assert.deepEqual(mergeStaleEditState([local], [removed], exact), [removed]);
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

test('microsecond-adjacent page edit cannot roll back newer local edit', () => {
  const latest = comment(
    'edited',
    'Newer edit',
    '2026-10-12T09:00:00.000Z',
    '2026-10-13T10:00:00.123456Z',
  );
  const stale = {
    ...latest,
    body: 'Older edit',
    revision: 'edited-revision-older',
    editedAt: '2026-10-13T10:00:00.123000Z',
  };

  assert.deepEqual(mergePage([latest], [stale]), [latest]);
});

test('equal edited timestamp does not replace local edited state', () => {
  const latest = comment(
    'edited',
    'Local edit',
    '2026-10-12T09:00:00.000Z',
    '2026-10-13T10:00:00.123456+00:00',
  );
  const equal = {
    ...latest,
    body: 'Equal timestamp response',
    revision: 'edited-revision-equal',
    editedAt: '2026-10-13T10:00:00.123456Z',
  };

  assert.deepEqual(mergePage([latest], [equal]), [latest]);
});

test('incoming removal marker replaces locally edited text', () => {
  const latest = comment(
    'edited',
    'Edited text',
    '2026-10-12T09:00:00.000Z',
    '2026-10-13T10:00:00.123456Z',
  );
  const removed = {
    ...latest,
    body: null,
    revision: 'edited-revision-removed',
    removedAt: '2026-10-13T11:00:00.000Z',
  };

  assert.deepEqual(mergePage([latest], [removed]), [removed]);
});

test('stale edit merge preserves loaded row position', () => {
  const newest = comment('newest', 'Newest', '2026-10-13T09:00:00.000Z');
  const middle = comment('middle', 'Middle', '2026-10-12T09:00:00.000Z');
  const older = comment('older', 'Older', '2026-10-11T09:00:00.000Z');
  const currentOlder = { ...older, body: 'Current older' };

  assert.deepEqual(
    mergeStaleEditState([newest, middle, older], [newest], currentOlder),
    [newest, middle, currentOlder],
  );
});

test('restored page row keeps its server position on a stale refresh', () => {
  const newest = comment('newest', 'Newest', '2026-10-13T09:00:00.000Z');
  const middle = comment('middle', 'Middle', '2026-10-12T09:00:00.000Z');
  const older = comment('older', 'Older', '2026-10-11T09:00:00.000Z');

  assert.deepEqual(
    mergeStaleEditState([newest, older], [newest, middle, older], null),
    [newest, middle, older],
  );
});

test('editor refresh keeps loaded older-page rows without an exact result', () => {
  const newest = comment('newest', 'Newest', '2026-10-13T09:00:00.000Z');
  const older = comment('older', 'Draft owner', '2026-10-12T09:00:00.000Z');

  assert.deepEqual(mergeStaleEditState([newest, older], [newest], null), [
    newest,
    older,
  ]);
});

test('post slice reports only rows the reconciliation drops', () => {
  const page = Array.from({ length: COMMENT_PAGE_SIZE }, (_, index) =>
    comment(
      `page-${index}`,
      `Page ${index}`,
      `2026-10-13T09:${String(index).padStart(2, '0')}:00.000Z`,
    ),
  );
  const created = comment('created', 'New post', '2026-10-13T10:00:00.000Z');
  const posted = withPost(created, page, true).rows;
  assert.deepEqual(droppedCommentIds(page, posted), ['page-29']);
  assert.deepEqual(
    droppedCommentIds(page, retainEditTarget(posted, page, 'page-29')),
    [],
    'A retained edit target is not reported dropped',
  );
  assert.deepEqual(
    droppedCommentIds(
      page.slice(0, 10),
      withPost(created, page.slice(0, 10), false).rows,
    ),
    [],
    'A page below the bound drops nothing',
  );
});

test('re-appended rows clear cached history entries', () => {
  const older = comment('older', 'Older', '2026-10-12T09:00:00.000Z');
  const edited = {
    ...older,
    body: 'Edited',
    revision: 'older-revision-2',
    editedAt: '2026-10-13T10:00:00.000Z',
  };
  const other = comment('other', 'Other', '2026-10-11T09:00:00.000Z');
  const cachedPage = { events: [], hasMore: false };
  assert.deepEqual(staleHistoryIds([edited, other], { older: cachedPage }), [
    'older',
  ]);
  assert.deepEqual(
    staleHistoryIds([other], {}),
    [],
    'A row with no cached history entry is not reported',
  );
});

test('post reconciliation identifies only changed existing rows', () => {
  const unchanged = comment('unchanged', 'Unchanged', '2026-10-13T09:00:00.000Z');
  const edited = comment('edited', 'Before', '2026-10-12T09:00:00.000Z');
  const refreshed = {
    ...edited,
    body: 'After',
    editedAt: '2026-10-13T10:00:00.000Z',
    revision: 'edited-revision-2',
  };
  const newComment = comment('new', 'New', '2026-10-13T11:00:00.000Z');

  assert.deepEqual(
    changedCommentIds([unchanged, edited], [unchanged, refreshed, newComment]),
    ['edited'],
  );
});

test('ordinary page refresh still follows the refreshed page contents', () => {
  const newest = comment('newest', 'Newest', '2026-10-13T09:00:00.000Z');
  const older = comment('older', 'Older', '2026-10-12T09:00:00.000Z');

  assert.deepEqual(mergePage([newest, older], [newest]), [newest]);
});

test('a post that fills the refreshed page keeps the open edit target', () => {
  const page = Array.from({ length: COMMENT_PAGE_SIZE - 1 }, (_, index) =>
    comment(
      `page-${index}`,
      `Page ${index}`,
      `2026-10-13T09:${String(index).padStart(2, '0')}:00.000Z`,
    ),
  );
  const created = comment('created', 'New post', '2026-10-13T10:00:00.000Z');
  const target = comment('older', 'Draft owner', '2026-10-12T09:00:00.000Z');
  const posted = withPost(created, page, true).rows;
  assert.equal(
    posted.length,
    COMMENT_PAGE_SIZE,
    'The refreshed page fills the bounded list',
  );

  assert.deepEqual(retainEditTarget(posted, [...page, target], 'older'), [
    ...posted,
    target,
  ]);
  assert.equal(
    retainEditTarget(posted, [...page, target], null),
    posted,
    'A post with no open editor is unchanged',
  );
  assert.equal(
    retainEditTarget(page, [...page, target], 'page-0'),
    page,
    'A target already in the list is not duplicated',
  );
  assert.equal(
    retainEditTarget(posted, [...page, target], 'absent'),
    posted,
    'An open editor without a loaded row keeps the list unchanged',
  );
});
