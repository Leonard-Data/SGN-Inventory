import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATALOGUE_INCOMPLETE_PERCENT,
  cataloguePercent,
  catalogueProgress,
  emptyResultWording,
  indexCataloguePage,
  readEveryCataloguePage,
  startCatalogueLoad,
  type CatalogueLoadState,
} from './catalogue-load.ts';
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

const AT = '2026-10-20T00:00:00.000Z';

// The traversal a stub read answers: each page names the cursor the next one starts after, exactly
// as the endpoint's own pagination contract does.
function pagesByCursor(
  pages: Record<string, CataloguePage>,
): (after: string | null) => CataloguePage {
  return (after) => pages[after ?? 'start'] as CataloguePage;
}

test('every cursor is traversed and each batch is indexed as it arrives', async () => {
  const state = startCatalogueLoad('generation-1');
  const pages = {
    start: { properties: [property('a'), property('b')], nextCursor: 'b' },
    b: { properties: [property('c')], nextCursor: null },
  };
  const seen: number[] = [];
  let load: CatalogueLoadState = state;
  await readEveryCataloguePage({
    read: async (after) => pagesByCursor(pages)(after),
    from: load.nextCursor,
    signal: new AbortController().signal,
    onPage: (page) => {
      load = indexCataloguePage(load, page, AT);
      seen.push(load.loadedCount);
    },
  });
  // Sequential batches: the first page is indexed before the second is requested, so the index
  // grows as the traversal goes rather than after it.
  assert.deepEqual(seen, [2, 3]);
  assert.equal(load.loadedCount, 3);
  assert.deepEqual(
    load.index.map((entry) => entry.record.id),
    ['a', 'b', 'c'],
  );
  assert.equal(load.isComplete, true);
  assert.equal(load.lastSyncedAt, AT);
});

test('a late page cannot publish after its traversal was cancelled', async () => {
  const controller = new AbortController();
  const arriving = Promise.withResolvers<CataloguePage>();
  const received: CataloguePage[] = [];
  const pending = readEveryCataloguePage({
    read: () => arriving.promise,
    from: null,
    signal: controller.signal,
    onPage: (page) => received.push(page),
  });
  controller.abort();
  arriving.resolve({ properties: [property('a')], nextCursor: null });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(received, []);
});

test('a retried or duplicated row never inflates the loaded count', () => {
  const first = indexCataloguePage(
    startCatalogueLoad('generation-1'),
    { properties: [property('a'), property('b')], nextCursor: 'b' },
    AT,
  );
  // The same page arrives again, then a later page repeats a row it already delivered.
  const retried = indexCataloguePage(
    first,
    {
      properties: [property('a'), property('b')],
      nextCursor: 'b',
    },
    AT,
  );
  assert.equal(retried.loadedCount, 2);
  assert.equal(retried.index.length, 2);
  assert.equal(retried.index, first.index);
  const overlapping = indexCataloguePage(
    retried,
    {
      properties: [property('b'), property('c')],
      nextCursor: null,
    },
    AT,
  );
  assert.equal(overlapping.loadedCount, 3);
  assert.deepEqual(
    overlapping.index.map((entry) => entry.record.id),
    ['a', 'b', 'c'],
  );
});

test('the catalogue is complete only after the final batch is indexed', () => {
  const first = indexCataloguePage(
    startCatalogueLoad('generation-1'),
    { properties: [property('a')], nextCursor: 'a' },
    AT,
  );
  // A next cursor remains, so the load is not complete and holds no synchronization time yet.
  assert.equal(first.isComplete, false);
  assert.equal(first.lastSyncedAt, null);
  assert.equal(first.nextCursor, 'a');
  const last = indexCataloguePage(
    first,
    { properties: [property('b')], nextCursor: null },
    '2026-10-20T01:00:00.000Z',
  );
  assert.equal(last.isComplete, true);
  assert.equal(last.loadedCount, 2);
  assert.equal(last.lastSyncedAt, '2026-10-20T01:00:00.000Z');
  assert.equal(last.nextCursor, null);
});

test('the percentage stays below a hundred until the traversal is finished and indexed', () => {
  // A full count with a cursor still to follow is still loading.
  assert.equal(
    cataloguePercent(2000, 2000, false),
    CATALOGUE_INCOMPLETE_PERCENT,
  );
  // More rows than the count observed (a live insert or a lagging count) is clamped the same way.
  assert.equal(
    cataloguePercent(2100, 2000, false),
    CATALOGUE_INCOMPLETE_PERCENT,
  );
  assert.equal(cataloguePercent(1000, 2000, false), 50);
  assert.equal(cataloguePercent(2000, 2000, true), 100);
  // Rows already counted do not move the number when the same page is indexed again.
  const first = indexCataloguePage(
    startCatalogueLoad('generation-1'),
    { properties: [property('a'), property('b')], nextCursor: 'b' },
    AT,
  );
  const retried = indexCataloguePage(
    first,
    {
      properties: [property('a'), property('b')],
      nextCursor: 'b',
    },
    AT,
  );
  assert.equal(
    cataloguePercent(retried.loadedCount, 4, retried.isComplete),
    cataloguePercent(first.loadedCount, 4, first.isComplete),
  );
});

test('an unknown total states no percentage, and a zero total while loading stays indeterminate', () => {
  assert.equal(cataloguePercent(0, null, false), null);
  assert.equal(cataloguePercent(500, null, false), null);
  assert.equal(cataloguePercent(0, null, true), null);
  // A zero total divides nothing: while the traversal runs it is indeterminate, and only the
  // completed traversal may state the catalogue as finished.
  assert.equal(cataloguePercent(0, 0, false), null);
  assert.equal(cataloguePercent(0, 0, true), 100);

  const empty = startCatalogueLoad('generation-1');
  assert.equal(
    catalogueProgress(empty, { total: null, capturedAt: null }).progressPercent,
    null,
  );
  assert.equal(
    catalogueProgress(empty, { total: 0, capturedAt: AT }).progressPercent,
    null,
  );
});

test('the authorized total folds into a load without changing its rows', () => {
  const first = indexCataloguePage(
    startCatalogueLoad('generation-1'),
    { properties: [property('a')], nextCursor: 'a' },
    AT,
  );
  // The first page is searchable and states no percentage before the count arrives.
  const before = catalogueProgress(first, { total: null, capturedAt: null });
  assert.equal(before.loadedCount, 1);
  assert.equal(before.progressPercent, null);
  const after = catalogueProgress(first, { total: 4, capturedAt: AT });
  assert.equal(after.loadedCount, 1);
  assert.equal(after.totalCount, 4);
  assert.equal(after.countCapturedAt, AT);
  assert.equal(after.progressPercent, 25);
});

test('an interrupted load keeps its rows and offers an incomplete state', () => {
  const first = indexCataloguePage(
    startCatalogueLoad('generation-1'),
    { properties: [property('a'), property('b')], nextCursor: 'b' },
    AT,
  );
  const progress = catalogueProgress(first, { total: 10, capturedAt: AT });
  assert.equal(progress.loadedCount, 2);
  assert.equal(progress.isComplete, false);
  // The failed generation resumes from the cursor it stopped at, not from the first page.
  assert.equal(first.nextCursor, 'b');
});

test('an empty result from an incomplete catalogue is never the inventory is empty', () => {
  // The browser answered from the catalogue it holds: both an incomplete and a complete catalogue
  // state that nothing in the loaded properties matched, never that the inventory holds nothing.
  assert.equal(
    emptyResultWording({
      from: 'catalogue',
      loaded: true,
      complete: false,
      failed: false,
    }),
    'catalogue-no-matches',
  );
  // Nothing indexed yet states the load itself rather than a filtered result.
  assert.equal(
    emptyResultWording({
      from: 'catalogue',
      loaded: false,
      complete: false,
      failed: false,
    }),
    'catalogue-loading',
  );
  assert.equal(
    emptyResultWording({
      from: 'catalogue',
      loaded: false,
      complete: false,
      failed: true,
    }),
    'catalogue-failed',
  );
  // A completed catalogue that indexed nothing has answered for the whole authorized inventory.
  assert.equal(
    emptyResultWording({
      from: 'catalogue',
      loaded: false,
      complete: true,
      failed: false,
    }),
    'catalogue-no-matches',
  );
  // The server read of the whole inventory keeps its own definitive empty result.
  assert.equal(
    emptyResultWording({ from: 'inventory', filterCount: 0 }),
    'inventory',
  );
  assert.equal(
    emptyResultWording({ from: 'inventory', filterCount: 1 }),
    'filtered',
  );
  // A list narrowed to the reader's own records says that nothing they created matched, which is
  // a different fact from the inventory holding nothing.
  assert.equal(
    emptyResultWording({
      from: 'catalogue',
      loaded: true,
      complete: false,
      failed: false,
      createdByMine: true,
    }),
    'catalogue-none-created',
  );
  assert.equal(
    emptyResultWording({
      from: 'catalogue',
      loaded: false,
      complete: true,
      failed: false,
      createdByMine: true,
    }),
    'catalogue-none-created',
  );
});
