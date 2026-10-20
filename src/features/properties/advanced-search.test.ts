import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADVANCED_SEARCH_GC_MS,
  ADVANCED_SEARCH_QUERY_OPTIONS,
  ADVANCED_SEARCH_STALE_MS,
  advancedSearchKey,
  searchCriteria,
} from './advanced-search.ts';
import {
  inventoryFilters,
  noInventoryFilters,
  type InventoryFilters,
} from './filters.ts';
import { searchEndpoint } from './catalogue-results.ts';
import { CATALOGUE_SCHEMA_VERSION } from './catalogue.ts';

const CRITERIA = {
  query: 'le loi',
  filters: {
    ...noInventoryFilters,
    status: 'available',
    areaMin: '20',
  } satisfies InventoryFilters,
  sort: 'oldest',
};

test('an advanced page is keyed by its user scope, criteria, ordering and page', () => {
  const key = advancedSearchKey({
    scope: 'sales:sales:2',
    criteria: CRITERIA,
    page: 0,
  });
  assert.deepEqual(key, [
    'property-search',
    'sales:sales:2',
    'le loi',
    'status',
    'available',
    'areaMin',
    '20',
    'oldest',
    0,
  ]);
  // Each of the four dimensions is its own entry, so a page is never answered from a different
  // search's rows.
  for (const other of [
    advancedSearchKey({
      scope: 'reviewer:admin:1',
      criteria: CRITERIA,
      page: 0,
    }),
    advancedSearchKey({
      scope: 'sales:sales:2',
      criteria: { ...CRITERIA, query: 'ben thanh' },
      page: 0,
    }),
    advancedSearchKey({
      scope: 'sales:sales:2',
      criteria: {
        ...CRITERIA,
        filters: { ...CRITERIA.filters, status: 'sold' },
      },
      page: 0,
    }),
    advancedSearchKey({
      scope: 'sales:sales:2',
      criteria: { ...CRITERIA, sort: 'newest' },
      page: 0,
    }),
    advancedSearchKey({
      scope: 'sales:sales:2',
      criteria: { ...CRITERIA, sort: null },
      page: 0,
    }),
    advancedSearchKey({
      scope: 'sales:sales:2',
      criteria: CRITERIA,
      page: 100,
    }),
  ])
    assert.notDeepEqual(other, key);
  // A different page of the same search is the same key with its own page.
  assert.deepEqual(
    advancedSearchKey({
      scope: 'sales:sales:2',
      criteria: CRITERIA,
      page: 100,
    }),
    [...key.slice(0, key.length - 1), 100],
  );
});

test('the same criteria always produce the same key, and never the catalogue key', () => {
  const once = advancedSearchKey({
    scope: 'sales:sales:2',
    criteria: {
      query: '  le loi  ',
      filters: { ...noInventoryFilters, status: 'available', areaMin: '20' },
      sort: 'oldest',
    },
    page: 0,
  });
  const again = advancedSearchKey({
    scope: 'sales:sales:2',
    criteria: {
      query: 'le loi',
      // The filter set's own key order decides the pairs, so the same criteria always key the same
      // way whatever order they were set in.
      filters: { ...noInventoryFilters, areaMin: '20', status: 'available' },
      sort: 'oldest',
    },
    page: 0,
  });
  assert.deepEqual(once, again);
  assert.equal(once[0], 'property-search');
  // The catalogue keeps its own namespace and its own retention: an advanced result is never read
  // back as a catalogue page, or the other way round.
  const catalogueKey = [
    'property-catalogue',
    'sales:sales:2',
    2,
    CATALOGUE_SCHEMA_VERSION,
  ];
  assert.notEqual(catalogueKey[0], once[0]);
  assert.notDeepEqual(catalogueKey, once);
});

test('advanced results are retained for a bounded time, separate from the catalogue', () => {
  assert.ok(ADVANCED_SEARCH_GC_MS > 0);
  assert.ok(Number.isFinite(ADVANCED_SEARCH_GC_MS));
  assert.ok(ADVANCED_SEARCH_STALE_MS > 0);
  assert.ok(ADVANCED_SEARCH_STALE_MS <= ADVANCED_SEARCH_GC_MS);
  assert.equal(ADVANCED_SEARCH_QUERY_OPTIONS.gcTime, ADVANCED_SEARCH_GC_MS);
  assert.equal(
    ADVANCED_SEARCH_QUERY_OPTIONS.staleTime,
    ADVANCED_SEARCH_STALE_MS,
  );
  // The catalogue is kept for the browser session; this cache is bounded and reads its pages again
  // once they have gone.
  assert.notEqual(ADVANCED_SEARCH_QUERY_OPTIONS.gcTime, Infinity);
  assert.notEqual(ADVANCED_SEARCH_QUERY_OPTIONS.staleTime, Infinity);
});

// A presentation change is not a submission. Switching cards/table or refreshing the language
// re-renders the list with a freshly built filter record and an address whose parameters are in
// another order; the search it names is the same one, so the reader keys the same window and
// reopens nothing.
test('a presentation change cannot reopen a submitted search', () => {
  const scope = 'sales:sales:2';
  const windowKey = (address: URLSearchParams) =>
    advancedSearchKey({
      scope,
      criteria: searchCriteria(
        searchEndpoint({
          query: address.get('query') ?? '',
          sort: address.get('sort'),
          filters: inventoryFilters(address),
        }),
      ),
      page: 0,
    });
  const submitted = windowKey(
    new URLSearchParams({
      query: 'le loi',
      sort: 'oldest',
      status: 'available',
    }),
  );
  // After that render: another view, another parameter order, another filter record.
  const presented = windowKey(
    new URLSearchParams({
      view: 'table',
      status: 'available',
      query: 'le loi',
      sort: 'oldest',
    }),
  );
  assert.deepEqual(presented, submitted);
  // A submission that really states other criteria or another ordering is another window.
  for (const other of [
    { query: 'ben thanh', sort: 'oldest', status: 'available' },
    { query: 'le loi', sort: 'newest', status: 'available' },
    { query: 'le loi', sort: 'oldest', status: 'sold' },
  ])
    assert.notDeepEqual(windowKey(new URLSearchParams(other)), submitted);
});
