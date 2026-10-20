import assert from 'node:assert/strict';
import test from 'node:test';
import {
  indexCataloguePage,
  startCatalogueLoad,
  type CatalogueCount,
  type CatalogueLoadState,
} from './catalogue-load.ts';
import {
  acceptReplacementPage,
  acceptWorking,
  beginRefresh,
  catalogueRefreshView,
  failReplacement,
  NO_GENERATIONS,
  refreshing,
  refreshResumes,
  startWorking,
  type CatalogueGenerations,
} from './catalogue-refresh.ts';
import type { CataloguePage, PropertySummary } from './types.ts';

function property(id: string, addressText = `${id} Le Loi`): PropertySummary {
  return {
    id,
    propertyCode: `BDS-${id}`,
    listingMode: 'sale',
    status: 'available',
    propertyType: 'house',
    salePriceVnd: null,
    monthlyRentVnd: null,
    createdAt: null,
    updatedAt: null,
    addresses: [
      {
        id: `address-${id}`,
        format: 'legacy',
        addressText,
        mappingStatus: 'unresolved',
        isPrimary: true,
        houseNumber: id,
        street: 'Le Loi',
        commune: null,
        district: 'Quan 1',
      },
    ],
    coverFileId: null,
    frontageM: null,
    depthM: null,
    landAreaM2: null,
    floorAreaM2: null,
    floors: null,
    direction: null,
    accessType: null,
    createdBy: null,
  };
}

// The generation the user already has: one finished traversal with its own synchronization time.
const SYNCED_AT = '2026-10-01T00:00:00.000Z';
const LATER = '2026-10-20T00:00:00.000Z';
const NO_COUNT: CatalogueCount = { total: null, capturedAt: null };

function finished(
  generationId: string,
  properties: readonly PropertySummary[],
  syncedAt = SYNCED_AT,
): CatalogueLoadState {
  return indexCataloguePage(
    startCatalogueLoad(generationId),
    { properties: [...properties], nextCursor: null },
    syncedAt,
  );
}

function page(
  properties: readonly PropertySummary[],
  nextCursor: string | null,
): CataloguePage {
  return { properties: [...properties], nextCursor };
}

function withWorking(working: CatalogueLoadState): CatalogueGenerations {
  return { ...NO_GENERATIONS, working };
}

const ids = (state: CatalogueLoadState) => state.index.map((e) => e.record.id);

test('a refresh never mutates the catalogue the user is searching', () => {
  const working = finished('working', [property('a'), property('b')]);
  const started = beginRefresh(withWorking(working), 'refresh-1');
  assert.equal(refreshing(started), true);

  const first = acceptReplacementPage(
    started,
    'refresh-1',
    page([property('c')], 'c'),
    LATER,
  );
  const second = acceptReplacementPage(
    first,
    'refresh-1',
    page([property('d')], 'd'),
    LATER,
  );

  // The working catalogue is the same rows with the same synchronization time throughout: what the
  // list and the address box search never changes while a replacement is being built.
  for (const state of [started, first, second]) {
    assert.deepEqual(state.working, working);
    assert.equal(state.working?.lastSyncedAt, SYNCED_AT);
    assert.deepEqual(ids(state.working as CatalogueLoadState), ['a', 'b']);
  }
  assert.deepEqual(ids(second.staged as CatalogueLoadState), ['c', 'd']);
  assert.equal(second.staged?.loadedCount, 2);
});

test('only a completed replacement swaps in, and it is a real refresh', () => {
  const working = finished('working', [
    property('keep', '1 Old Street'),
    property('deleted'),
    property('became-inaccessible'),
  ]);
  const running = beginRefresh(withWorking(working), 'refresh-1');
  // The replacement carries a changed value for a property that still exists, a new property, and
  // neither of the two the read no longer returns.
  const partial = acceptReplacementPage(
    running,
    'refresh-1',
    page([property('keep', '1 New Street'), property('added')], 'added'),
    LATER,
  );
  // A traversal that has not ended has not swapped: the previous catalogue is still the one in use
  // even though the replacement already holds both new rows.
  assert.deepEqual(ids(partial.working as CatalogueLoadState), [
    'keep',
    'deleted',
    'became-inaccessible',
  ]);

  const swapped = acceptReplacementPage(
    partial,
    'refresh-1',
    page([property('added')], null),
    LATER,
  );
  assert.equal(swapped.staged, null);
  assert.equal(swapped.failure, null);
  assert.equal(swapped.working?.isComplete, true);
  assert.equal(swapped.working?.lastSyncedAt, LATER);
  assert.equal(swapped.working?.generationId, 'refresh-1');
  // Added and changed rows are the replacement's, and the deleted and newly inaccessible rows are
  // gone because the replacement never carried them.
  assert.deepEqual(ids(swapped.working as CatalogueLoadState), [
    'keep',
    'added',
  ]);
  assert.equal(
    swapped.working?.index[0]?.record.addresses[0]?.addressText,
    '1 New Street',
  );
});

test('a failed refresh leaves the previous catalogue and its synchronization time intact', () => {
  const working = finished('working', [property('a')]);
  const running = beginRefresh(withWorking(working), 'refresh-1');
  const partial = acceptReplacementPage(
    running,
    'refresh-1',
    page([property('b')], 'b'),
    LATER,
  );
  const failed = failReplacement(partial, 'refresh-1', 'unavailable');

  assert.deepEqual(failed.working, working);
  assert.equal(failed.working?.lastSyncedAt, SYNCED_AT);
  assert.equal(failed.working?.isComplete, true);
  assert.deepEqual(failed.failure, { code: 'unavailable', resumable: true });
  // The failure is stated as a failure, and the refresh line cannot describe a completed load.
  const view = catalogueRefreshView(failed, NO_COUNT);
  assert.deepEqual(view, {
    status: 'failed',
    resumable: true,
    loadedCount: 1,
  });
});

test('a superseded generation changes nothing', () => {
  const working = finished('working', [property('a')]);
  const running = beginRefresh(withWorking(working), 'refresh-1');

  // The scope changed: a new authorized context replaces the working catalogue and clears anything
  // staged under the former authority.
  const rescoped = startWorking('working-2');
  assert.equal(rescoped.staged, null);
  assert.equal(rescoped.failure, null);
  assert.deepEqual(
    acceptReplacementPage(
      rescoped,
      'refresh-1',
      page([property('z')], null),
      LATER,
    ),
    rescoped,
  );
  assert.deepEqual(
    failReplacement(rescoped, 'refresh-1', 'unavailable'),
    rescoped,
  );
  // A late response from the former working generation is discarded the same way.
  assert.deepEqual(acceptWorking(rescoped, working), rescoped);

  // A batch from a generation that is not the running one changes nothing either, and does not
  // become a second replacement.
  assert.deepEqual(
    acceptReplacementPage(
      running,
      'refresh-2',
      page([property('z')], null),
      LATER,
    ),
    running,
  );
  assert.equal(running.staged?.generationId, 'refresh-1');
  // A failure reported for a generation that is not the running one is not a state either.
  assert.deepEqual(
    failReplacement(running, 'refresh-2', 'unavailable'),
    running,
  );
});

test('overlapping loads are prevented', () => {
  const working = finished('working', [property('a')]);
  const running = beginRefresh(withWorking(working), 'refresh-1');
  const second = beginRefresh(running, 'refresh-2');

  // The second start is refused outright: the same state, still building generation refresh-1.
  assert.equal(second, running);
  assert.equal(second.staged?.generationId, 'refresh-1');
  // The running generation still accepts its own batches, so refusing the overlap did not stall it.
  assert.equal(
    acceptReplacementPage(
      running,
      'refresh-1',
      page([property('b')], 'b'),
      LATER,
    ).staged?.loadedCount,
    1,
  );
});

test('a refresh is refused while the user has no complete catalogue to replace', () => {
  // No catalogue at all.
  assert.equal(beginRefresh(NO_GENERATIONS, 'refresh-1'), NO_GENERATIONS);
  // An initial load still arriving: the catalogue the user is building is not something a
  // replacement can preserve.
  const arriving = acceptWorking(
    startWorking('working-1'),
    indexCataloguePage(
      startCatalogueLoad('working-1'),
      page([property('a')], 'a'),
      LATER,
    ),
  );
  assert.equal(beginRefresh(arriving, 'refresh-1'), arriving);
  assert.equal(arriving.staged, null);
});

test('Retry resumes a compatible cursor instead of reading the inventory again', () => {
  const working = finished('working', [property('a')]);
  const running = beginRefresh(withWorking(working), 'refresh-1');
  const partial = acceptReplacementPage(
    running,
    'refresh-1',
    page([property('a'), property('b')], 'b'),
    LATER,
  );
  const stopped = failReplacement(partial, 'refresh-1', 'unavailable');

  // The staged rows and the cursor after the last indexed batch are kept, so Retry continues where
  // the traversal stopped rather than starting the whole catalogue again.
  assert.equal(stopped.staged?.nextCursor, 'b');
  assert.equal(stopped.staged?.loadedCount, 2);
  const continued = beginRefresh(
    stopped,
    stopped.staged?.generationId as string,
    stopped.staged,
  );
  assert.equal(continued.resumed, true);
  assert.equal(continued.failure, null);
  assert.equal(continued.staged?.loadedCount, 2);
  assert.equal(continued.staged?.nextCursor, 'b');
  // The user is told which happened: a continued replacement keeps the progress it already made.
  assert.deepEqual(catalogueRefreshView(continued, NO_COUNT), {
    status: 'refreshing',
    resumed: true,
    loadedCount: 2,
    totalCount: null,
    progressPercent: null,
  });
});

test('an ended authority starts a clearly identified new generation with reset progress', () => {
  const working = finished('working', [property('a')]);
  const running = beginRefresh(withWorking(working), 'refresh-1');
  const partial = acceptReplacementPage(
    running,
    'refresh-1',
    page([property('a'), property('b')], 'b'),
    LATER,
  );
  const denied = failReplacement(partial, 'refresh-1', 'access-denied');

  // A refusal ends the traversal's authority: its staged rows are discarded and the line says so.
  assert.equal(denied.staged, null);
  assert.equal(denied.working?.isComplete, true);
  assert.deepEqual(denied.failure, { code: 'access-denied', resumable: false });
  assert.deepEqual(catalogueRefreshView(denied, NO_COUNT), {
    status: 'failed',
    resumable: false,
    loadedCount: 0,
  });

  // Retry therefore starts a new generation whose progress resets to nothing loaded.
  const restarted = beginRefresh(denied, 'refresh-2');
  assert.equal(restarted.resumed, false);
  assert.equal(restarted.staged?.generationId, 'refresh-2');
  assert.equal(restarted.staged?.loadedCount, 0);
  assert.equal(catalogueRefreshView(restarted, NO_COUNT).status, 'refreshing');
});

test('the refresh rule states which failures keep their authority', () => {
  assert.equal(refreshResumes('access-denied'), false);
  assert.equal(refreshResumes('unavailable'), true);
});

test('the refresh line describes the replacement and never the working catalogue', () => {
  const working = finished('working', [property('a')]);
  assert.deepEqual(catalogueRefreshView(withWorking(working), NO_COUNT), {
    status: 'idle',
  });

  const running = beginRefresh(withWorking(working), 'refresh-1');
  const staged = acceptReplacementPage(
    running,
    'refresh-1',
    page([property('a')], 'a'),
    LATER,
  );
  // A known total yields the replacement's own approximate percentage; an unknown one states the
  // loaded count alone, and the view can never state a completed load.
  assert.deepEqual(
    catalogueRefreshView(staged, { total: 4, capturedAt: LATER }),
    {
      status: 'refreshing',
      resumed: false,
      loadedCount: 1,
      totalCount: 4,
      progressPercent: 25,
    },
  );
  assert.deepEqual(catalogueRefreshView(staged, NO_COUNT), {
    status: 'refreshing',
    resumed: false,
    loadedCount: 1,
    totalCount: null,
    progressPercent: null,
  });
  // A zero authorized total while the traversal is running stays indeterminate rather than dividing
  // by nothing.
  assert.deepEqual(
    catalogueRefreshView(staged, { total: 0, capturedAt: LATER }),
    {
      status: 'refreshing',
      resumed: false,
      loadedCount: 1,
      totalCount: null,
      progressPercent: null,
    },
  );
});

test('a second refresh over a swapped catalogue is allowed and refills from empty', () => {
  const working = finished('working', [property('keep'), property('gone')]);
  const swapped = acceptReplacementPage(
    acceptReplacementPage(
      beginRefresh(withWorking(working), 'refresh-1'),
      'refresh-1',
      page([property('keep')], 'keep'),
      LATER,
    ),
    'refresh-1',
    page([property('keep')], null),
    LATER,
  );
  assert.deepEqual(ids(swapped.working as CatalogueLoadState), ['keep']);

  const again = beginRefresh(swapped, 'refresh-2');
  assert.equal(again.staged?.generationId, 'refresh-2');
  assert.equal(again.staged?.loadedCount, 0);
  assert.deepEqual(again.working, swapped.working);
});
