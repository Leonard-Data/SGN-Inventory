import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAddressIndex } from './address-index.ts';
import {
  ADVANCED_FILTER_KEYS,
  advancedFilterKeys,
  advancedOrder,
  catalogueMatches,
  draftNeedsAdvancedSearch,
  matchesLocalFilters,
  orderCatalogue,
  resultMode,
  searchEndpoint,
} from './catalogue-results.ts';
import { noInventoryFilters, type InventoryFilters } from './filters.ts';
import {
  STREAM_PAGE_SIZE,
  localStreamWindows,
  streamChunkRows,
} from './stream.ts';
import type { AddressSummary, PropertySummary } from './types.ts';

const PROVINCE = '11111111-1111-4111-8111-111111111111';
const WARD = '22222222-2222-4222-8222-222222222222';
const CONTACT = '33333333-3333-4333-8333-333333333333';

function address(id: string, addressText: string): AddressSummary {
  return {
    id: `address-${id}`,
    format: 'legacy',
    addressText,
    mappingStatus: 'unresolved',
    isPrimary: true,
    houseNumber: id,
    street: 'Lê Lợi',
    commune: null,
    district: 'Quận 1',
  };
}

function property(
  id: string,
  values: Partial<PropertySummary> = {},
): PropertySummary {
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
    addresses: [address(id, `${id} Lê Lợi, Quận 1`)],
    coverFileId: null,
    frontageM: null,
    depthM: null,
    landAreaM2: null,
    floorAreaM2: null,
    floors: null,
    direction: null,
    accessType: null,
    createdBy: null,
    ...values,
  };
}

test('every filter the catalogue carries a field for is offered locally, and no other is', () => {
  const stated: InventoryFilters = {
    ...noInventoryFilters,
    status: 'available',
    mode: 'rent',
    type: 'house',
    priceMin: '1000000000',
    priceMax: '9000000000',
    areaMin: '20',
    areaMax: '90.5',
  };
  assert.deepEqual(advancedFilterKeys(stated), []);
  // The criteria whose fields the summaries do not carry are named as advanced, so they are never
  // applied as if the loaded rows could answer them.
  for (const key of ADVANCED_FILTER_KEYS)
    assert.deepEqual(
      advancedFilterKeys({ ...noInventoryFilters, [key]: PROVINCE }),
      [key],
    );
  assert.deepEqual(
    advancedFilterKeys({
      ...noInventoryFilters,
      province: PROVINCE,
      ward: WARD,
      contact: CONTACT,
      status: 'available',
    }),
    ['province', 'ward', 'contact'],
  );
});

test('a supported filter, a typed search and the plain browse are answered by the catalogue', () => {
  for (const stated of [
    { query: '', filters: noInventoryFilters },
    { query: '', filters: { ...noInventoryFilters, status: 'available' } },
    { query: '', filters: { ...noInventoryFilters, areaMin: '20' } },
    {
      query: '',
      filters: { ...noInventoryFilters, priceMin: '1000000000', mode: 'rent' },
    },
  ])
    for (const typing of [true, false])
      assert.equal(
        resultMode({ ...stated, sort: null, typing }),
        'catalogue',
        JSON.stringify(stated),
      );
});

test('criteria the catalogue cannot answer route to an advanced search', () => {
  // A province, a ward or a contact names a database catalog identity the summaries do not carry,
  // so it is an advanced search even while the box is being edited.
  for (const filters of [
    { ...noInventoryFilters, province: PROVINCE },
    { ...noInventoryFilters, ward: WARD },
    { ...noInventoryFilters, contact: CONTACT },
  ])
    for (const typing of [true, false])
      assert.equal(
        resultMode({ query: '', filters, sort: null, typing }),
        'advanced',
      );
  // A stated ordering is the eligible-status chronology the database reads, and an ordering this
  // application does not know is refused by that read rather than served as another order.
  for (const sort of ['oldest', 'newest', 'anything-else'])
    for (const typing of [true, false])
      assert.equal(
        resultMode({ query: '', filters: noInventoryFilters, sort, typing }),
        'advanced',
        String(sort),
      );
  assert.equal(advancedOrder(null), false);
  assert.equal(advancedOrder(''), false);
  // A submitted query searches the whole inventory; typing in the box narrows the loaded catalogue
  // instead.
  assert.equal(
    resultMode({
      query: 'le loi',
      filters: noInventoryFilters,
      sort: null,
      typing: false,
    }),
    'advanced',
  );
  assert.equal(
    resultMode({
      query: 'le loi',
      filters: noInventoryFilters,
      sort: null,
      typing: true,
    }),
    'catalogue',
  );
});

test('a stated filter set the database read would refuse is never applied locally', () => {
  // The read is what validates the bounds, so a set it would refuse is handed to it instead of
  // being applied as a different filter here.
  for (const filters of [
    { status: 'nonsense' },
    { mode: 'lease' },
    { type: 'castle' },
    { priceMin: 'abc' },
    { priceMin: '1.5' },
    { areaMin: '0' },
    { areaMax: '10.005' },
    { priceMin: '9000000000', priceMax: '1000000000' },
    { areaMin: '90', areaMax: '20' },
    { ward: WARD },
    { province: 'not-a-unit' },
  ])
    for (const typing of [true, false])
      assert.equal(
        resultMode({
          query: '',
          filters: { ...noInventoryFilters, ...filters },
          sort: null,
          typing,
        }),
        'advanced',
        JSON.stringify(filters),
      );
});

test('a submitted search states its criteria in one address and nothing else', () => {
  const filters = { ...noInventoryFilters, status: 'available', mode: 'rent' };
  const endpoint = searchEndpoint({
    query: 'le loi',
    sort: 'oldest',
    filters,
  });
  const stated = (address: string) =>
    Object.fromEntries(
      new URLSearchParams(address.slice(address.indexOf('?') + 1)),
    );
  // The read names the submitted criteria and nothing a render chooses: the view, the language and
  // every other presentation choice are not part of it.
  assert.deepEqual(stated(endpoint), {
    query: 'le loi',
    sort: 'oldest',
    status: 'available',
    mode: 'rent',
  });
  // A record a render rebuilt names the same address, so it names the same search.
  assert.equal(
    searchEndpoint({
      query: 'le loi',
      sort: 'oldest',
      filters: { ...filters },
    }),
    endpoint,
  );
  // An unstated ordering and an unstated filter stay out of the address rather than naming a
  // different search.
  assert.deepEqual(
    stated(
      searchEndpoint({ query: '', sort: null, filters: noInventoryFilters }),
    ),
    { query: '' },
  );
});

// Editing the panel is not a submission: the draft is only classified when the panel is run, and
// its action names the whole-inventory search only for the criteria the catalogue cannot answer.
// What a submission then does is the address it builds, which `resultMode` classifies above.
test('a draft is an advanced search only when it holds a criterion the catalogue cannot answer', () => {
  const localOnly = { province: '', ward: '', contact: '', order: '' };
  assert.equal(draftNeedsAdvancedSearch(localOnly, ''), false);
  assert.equal(draftNeedsAdvancedSearch(localOnly, '   '), false);
  for (const key of ['province', 'ward', 'contact', 'order'] as const)
    assert.equal(
      draftNeedsAdvancedSearch({ ...localOnly, [key]: 'chosen' }, ''),
      true,
      key,
    );
  // The address's query travels with the panel's run, so a draft run carrying it is the same
  // whole-inventory search the address itself states.
  assert.equal(draftNeedsAdvancedSearch(localOnly, 'le loi'), true);
  assert.equal(
    resultMode({
      query: 'le loi',
      filters: noInventoryFilters,
      sort: null,
      typing: false,
    }),
    'advanced',
  );
});

test('a local filter is applied to the recorded fields exactly as the database read applies it', () => {
  const both = property('both', {
    listingMode: 'both',
    salePriceVnd: '5000000000',
    monthlyRentVnd: '20000000',
  });
  const sale = property('sale', { salePriceVnd: '5000000000' });
  const rent = property('rent', {
    listingMode: 'rent',
    monthlyRentVnd: '20000000',
  });
  const unclassified = property('unclassified', {
    propertyType: 'unclassified',
    status: 'sold',
  });
  const kept = (filters: Partial<InventoryFilters>, record: PropertySummary) =>
    matchesLocalFilters(record, { ...noInventoryFilters, ...filters });

  // A `both` listing matches either stated mode.
  for (const mode of ['sale', 'rent'] as const)
    assert.equal(kept({ mode }, both), true);
  assert.equal(kept({ mode: 'sale' }, sale), true);
  assert.equal(kept({ mode: 'sale' }, rent), false);
  assert.equal(kept({ mode: 'rent' }, sale), false);
  assert.equal(kept({ status: 'available' }, unclassified), false);
  assert.equal(kept({ type: 'house' }, unclassified), false);

  // A price bound follows the stated mode, or the record's own listing mode when none is stated.
  assert.equal(
    kept({ priceMin: '4000000000', priceMax: '6000000000' }, sale),
    true,
  );
  assert.equal(kept({ priceMin: '4000000000' }, rent), false);
  assert.equal(
    kept({ mode: 'rent', priceMin: '10000000', priceMax: '30000000' }, rent),
    true,
  );
  assert.equal(
    kept({ mode: 'rent', priceMin: '10000000', priceMax: '30000000' }, sale),
    false,
  );
  // Half a range is still a range, and a record with no recorded price never satisfies one.
  assert.equal(kept({ priceMax: '1000000' }, sale), false);
  assert.equal(kept({ priceMin: '1000' }, unclassified), false);
  // A range with neither bound stated is skipped rather than applied as a zero.
  assert.equal(kept({}, unclassified), true);

  const measured = property('measured', {
    landAreaM2: '80.00',
    floorAreaM2: '240.50',
  });
  // Either recorded area satisfies the range, as it does in the database read.
  assert.equal(kept({ areaMin: '70', areaMax: '85' }, measured), true, 'land');
  assert.equal(
    kept({ areaMin: '240', areaMax: '241' }, measured),
    true,
    'floor',
  );
  assert.equal(kept({ areaMin: '300' }, measured), false);
  assert.equal(kept({ areaMin: '10' }, unclassified), false);
});

test('the catalogue orders newest-created first, then identity descending', () => {
  const older = property('a', { createdAt: '2026-01-01T00:00:00.000Z' });
  const newer = property('b', { createdAt: '2026-05-01T00:00:00.000Z' });
  const tiedLow = property('c', { createdAt: '2026-05-01T00:00:00.000Z' });
  const tiedHigh = property('d', { createdAt: '2026-05-01T00:00:00.000Z' });
  const ordered = orderCatalogue(
    [older, tiedLow, newer, tiedHigh].map((record) => ({
      record,
      format: 'legacy',
    })),
  );
  assert.deepEqual(
    ordered.map((match) => match.record.id),
    ['d', 'c', 'b', 'a'],
  );
});

test('a typed query keeps the address ranking and a browse takes the catalogue order', () => {
  // Equal-ranked matches tie on the property identity ascending, which is not the browse order.
  const index = buildAddressIndex([
    property('a', { createdAt: '2026-01-01T00:00:00.000Z' }),
    property('b', { createdAt: '2026-05-01T00:00:00.000Z' }),
    property('c', { createdAt: '2026-03-01T00:00:00.000Z' }),
  ]);
  const ids = (query: string, filters: InventoryFilters = noInventoryFilters) =>
    catalogueMatches(index, { query, filters }).map((match) => match.record.id);
  assert.deepEqual(ids('le loi'), ['a', 'b', 'c']);
  assert.deepEqual(ids(''), ['b', 'c', 'a']);
  assert.deepEqual(ids('', { ...noInventoryFilters, status: 'sold' }), []);
});

test('the browser pages the local answer from the rows it holds', () => {
  const records = Array.from({ length: 250 }, (_, index) =>
    property(String(index), {
      createdAt: `2026-01-01T00:00:0${index % 10}.000Z`,
    }),
  );
  const index = buildAddressIndex(records);
  const rows = catalogueMatches(index, {
    query: '',
    filters: noInventoryFilters,
  });
  assert.equal(rows.length, 250);
  const windows = localStreamWindows(rows);
  // Every window of the answer is in the browser already, so the band a deep scroll needs draws
  // the rows it reserved without a read behind any of them.
  assert.deepEqual(
    [...windows.keys()],
    [0, STREAM_PAGE_SIZE, STREAM_PAGE_SIZE * 2],
  );
  assert.deepEqual(
    streamChunkRows(windows, 240, 12, STREAM_PAGE_SIZE, rows.length)?.map(
      (row) => row.record.id,
    ),
    rows.slice(240, 250).map((row) => row.record.id),
  );
});
