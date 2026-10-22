import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAddressIndex } from './address-index.ts';
import {
  ADVANCED_FILTER_KEYS,
  advancedFilterKeys,
  advancedOrder,
  catalogueMatches,
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
const DISTRICT = '55555555-5555-4555-8555-555555555555';
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
    accessType: 'street_front',
    priceMin: '1000000000',
    priceMax: '9000000000',
    areaMin: '20',
    areaMax: '90.5',
    frontageMin: '4',
    frontageMax: '12',
    depthMin: '16',
    depthMax: '30',
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

test('a supported filter, a blank search and the plain browse are answered by the catalogue', () => {
  for (const stated of [
    { query: '', filters: noInventoryFilters },
    { query: '   ', filters: noInventoryFilters },
    { query: '', filters: { ...noInventoryFilters, status: 'available' } },
    { query: '', filters: { ...noInventoryFilters, areaMin: '20' } },
    { query: '', filters: { ...noInventoryFilters, frontageMin: '4' } },
    { query: '', filters: { ...noInventoryFilters, depthMax: '30' } },
    {
      query: '',
      filters: { ...noInventoryFilters, accessType: 'motorbike_alley' },
    },
    {
      query: '',
      filters: { ...noInventoryFilters, priceMin: '1000000000', mode: 'rent' },
    },
  ])
    assert.equal(
      resultMode({ ...stated, sort: null }),
      'catalogue',
      JSON.stringify(stated),
    );
});

test('criteria the catalogue cannot answer route to an advanced search', () => {
  // A province, a district, a ward or a contact names a database catalog identity the summaries
  // do not carry, so each is an advanced search.
  for (const filters of [
    { ...noInventoryFilters, province: PROVINCE },
    { ...noInventoryFilters, province: PROVINCE, district: DISTRICT },
    { ...noInventoryFilters, ward: WARD },
    { ...noInventoryFilters, contact: CONTACT },
  ])
    assert.equal(resultMode({ query: '', filters, sort: null }), 'advanced');
  // A stated ordering is the eligible-status chronology the database reads, and an ordering this
  // application does not know is refused by that read rather than served as another order.
  for (const sort of ['oldest', 'newest', 'anything-else'])
    assert.equal(
      resultMode({ query: '', filters: noInventoryFilters, sort }),
      'advanced',
      String(sort),
    );
  assert.equal(advancedOrder(null), false);
  assert.equal(advancedOrder(''), false);
  // The address is the submission: a query it states is the whole-inventory search the person
  // asked for, whether or not the box has been edited since.
  assert.equal(
    resultMode({ query: 'le loi', filters: noInventoryFilters, sort: null }),
    'advanced',
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
    { frontageMin: '0' },
    { depthMax: '10.005' },
    { frontageMin: '12', frontageMax: '4' },
    { depthMin: '30', depthMax: '16' },
    { ward: WARD },
    { province: 'not-a-unit' },
  ])
    assert.equal(
      resultMode({
        query: '',
        filters: { ...noInventoryFilters, ...filters },
        sort: null,
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
    addressFormat: 'legacy',
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
  // different search. The address format is the exception: it is always one of the two formats, so
  // the read is always told which recorded address it is asked to search.
  assert.deepEqual(
    stated(
      searchEndpoint({ query: '', sort: null, filters: noInventoryFilters }),
    ),
    { query: '', addressFormat: 'legacy' },
  );
  // The creator selection is answered from the loaded catalogue alone, so it never becomes a
  // criterion this read is asked to apply and then cannot.
  assert.deepEqual(
    stated(
      searchEndpoint({
        query: 'le loi',
        sort: 'oldest',
        filters: { ...filters, createdBy: 'mine' },
      }),
    ),
    stated(endpoint),
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

  // The access type is the recorded state itself: the value recorded as "not known" is a state to
  // filter by, not the cleared filter, and a record with no recorded state never matches one.
  const streetFront = property('street-front', { accessType: 'street_front' });
  assert.equal(kept({ accessType: 'street_front' }, streetFront), true);
  assert.equal(kept({ accessType: 'car_alley' }, streetFront), false);
  assert.equal(kept({ accessType: 'unknown' }, streetFront), false);
  assert.equal(kept({ accessType: 'unknown' }, unclassified), false);
  assert.equal(kept({}, unclassified), true);

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

  // A dimension range follows the recorded frontage or depth exactly, as the database read does,
  // and a property recording no dimension never matches a stated bound: unknown is not zero.
  const sized = property('sized', { frontageM: '4.50', depthM: '16.00' });
  assert.equal(kept({ frontageMin: '4', frontageMax: '5' }, sized), true);
  assert.equal(kept({ frontageMax: '4' }, sized), false);
  assert.equal(kept({ depthMin: '16', depthMax: '16.00' }, sized), true);
  assert.equal(kept({ depthMin: '16.01' }, sized), false);
  assert.equal(kept({ frontageMin: '1', depthMax: '20' }, sized), true);
  assert.equal(kept({ frontageMin: '1' }, unclassified), false);
  assert.equal(kept({ depthMax: '20' }, unclassified), false);
  // A half dimension is the one recorded value the stated bound compares against.
  assert.equal(
    kept({ depthMin: '20' }, property('half', { frontageM: '30' })),
    false,
  );
});

test('the creator selection compares who created the record, not their name', () => {
  const employee = '99999999-9999-4999-8999-999999999999';
  const colleague = '88888888-8888-4888-8888-888888888888';
  const mine = property('mine', {
    createdById: employee,
    createdBy: 'Nguyễn Thu Hà',
  });
  // The same display name can belong to two colleagues, so the name never decides this.
  const theirs = property('theirs', {
    createdById: colleague,
    createdBy: 'Nguyễn Thu Hà',
  });
  const unstated = property('unstated');
  const filters = { ...noInventoryFilters, createdBy: 'mine' };
  const kept = (
    record: PropertySummary,
    employeeId: string | null = employee,
  ) => matchesLocalFilters(record, filters, employeeId);
  assert.equal(kept(mine), true);
  assert.equal(kept(theirs), false);
  // A summary that states no creator identity, and a list read without an employee, never match.
  assert.equal(kept(unstated), false);
  assert.equal(kept(mine, null), false);
  // Without the selection the same records are all kept, so the filter narrows rather than hides.
  assert.equal(matchesLocalFilters(theirs, noInventoryFilters, employee), true);
});

test('the creator selection composes with the other filters and the address search', () => {
  const employee = '99999999-9999-4999-8999-999999999999';
  const colleague = '88888888-8888-4888-8888-888888888888';
  const index = buildAddressIndex([
    property('mine-available', {
      createdById: employee,
      createdAt: '2026-05-01T00:00:00.000Z',
    }),
    property('mine-sold', {
      createdById: employee,
      status: 'sold',
      createdAt: '2026-04-01T00:00:00.000Z',
    }),
    property('theirs-available', {
      createdById: colleague,
      createdAt: '2026-03-01T00:00:00.000Z',
    }),
  ]);
  const ids = (
    query: string,
    stated: Partial<InventoryFilters>,
    employeeId: string | null = employee,
  ) =>
    catalogueMatches(index, {
      query,
      filters: { ...noInventoryFilters, ...stated },
      employeeId,
    })
      .map((match) => match.record.id)
      .sort();
  // The selection narrows the browse to the reader's own records.
  assert.deepEqual(ids('', { createdBy: 'mine' }), [
    'mine-available',
    'mine-sold',
  ]);
  // A second filter still applies on top of it, and the selection on top of the second filter.
  assert.deepEqual(ids('', { createdBy: 'mine', status: 'available' }), [
    'mine-available',
  ]);
  assert.deepEqual(ids('', { status: 'available' }), [
    'mine-available',
    'theirs-available',
  ]);
  // The typed address search keeps its ranking and is narrowed by the same selection.
  assert.deepEqual(ids('le loi', { createdBy: 'mine' }), [
    'mine-available',
    'mine-sold',
  ]);
  assert.deepEqual(ids('le loi', {}), [
    'mine-available',
    'mine-sold',
    'theirs-available',
  ]);
});

test('the catalogue orders most recently changed first, then identity descending', () => {
  // The change time is what orders the list; the creation time is deliberately not, so a record
  // created early and edited just now leads the list it used to sit at the bottom of.
  const edited = property('a', {
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  });
  const createdLate = property('b', {
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  });
  const tiedLow = property('c', {
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  });
  const tiedHigh = property('d', {
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  });
  const never = property('e', { createdAt: '2026-04-01T00:00:00.000Z' });
  const ordered = orderCatalogue(
    [createdLate, tiedLow, edited, never, tiedHigh].map((record) => ({
      record,
      format: 'legacy',
    })),
  );
  assert.deepEqual(
    ordered.map((match) => match.record.id),
    ['a', 'd', 'c', 'b', 'e'],
  );
});

test('a typed query keeps the address ranking and a browse takes the catalogue order', () => {
  // Equal-ranked matches tie on the property identity ascending, which is not the browse order.
  const index = buildAddressIndex([
    property('a', {
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    property('b', {
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    }),
    property('c', {
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    }),
  ]);
  const ids = (query: string, filters: InventoryFilters = noInventoryFilters) =>
    catalogueMatches(index, { query, filters }).map((match) => match.record.id);
  assert.deepEqual(ids('le loi'), ['a', 'b', 'c']);
  assert.deepEqual(ids(''), ['b', 'c', 'a']);
  assert.deepEqual(ids('', { ...noInventoryFilters, status: 'sold' }), []);
  // The database's own search matches the recorded property code, so a code typed into the box
  // finds its loaded row, alone or beside a local filter.
  assert.deepEqual(ids('BDS-b'), ['b']);
  assert.deepEqual(
    ids('BDS-b', { ...noInventoryFilters, status: 'available' }),
    ['b'],
  );
});

test('the address format decides which recorded address a search is matched through', () => {
  // The same house recorded in the two formats: the format filter states which of the recorded
  // addresses the query is compared with, and a property recording none of that format does not
  // match - exactly the database read's own exists-predicate, so the two answer the same set.
  const currentOf = (id: string, addressText: string): AddressSummary => ({
    ...address(id, addressText),
    id: `address-current-${id}`,
    format: 'current',
    district: null,
  });
  const onlyLegacy = property('legacy-only', {
    addresses: [address('legacy-only', '12 Lê Lợi, Quận 1')],
  });
  const onlyCurrent = property('current-only', {
    status: 'sold',
    addresses: [currentOf('current-only', '12 Lê Lợi, Phường Bến Nghé')],
  });
  const both = property('both', {
    addresses: [
      address('both', '12 Lê Lợi, Quận 1'),
      currentOf('both', '12 Lê Lợi, Phường Bến Nghé'),
    ],
  });
  const index = buildAddressIndex([onlyLegacy, onlyCurrent, both]);
  const ids = (query: string, stated: Partial<InventoryFilters> = {}) =>
    catalogueMatches(index, {
      query,
      filters: { ...noInventoryFilters, ...stated },
    })
      .map((match) => match.record.id)
      .sort();
  // The legacy address is the default the panel opens on.
  assert.deepEqual(ids(''), ['both', 'legacy-only']);
  assert.deepEqual(ids('', { addressFormat: 'current' }), [
    'both',
    'current-only',
  ]);
  // A word recorded in one format's address alone is answered by that format and no other.
  assert.deepEqual(ids('quan 1'), ['both', 'legacy-only']);
  assert.deepEqual(ids('quan 1', { addressFormat: 'current' }), []);
  assert.deepEqual(ids('ben nghe'), []);
  assert.deepEqual(ids('ben nghe', { addressFormat: 'current' }), [
    'both',
    'current-only',
  ]);
  // The format is one condition among the others, not a replacement for them.
  assert.deepEqual(ids('', { addressFormat: 'current', status: 'available' }), [
    'both',
  ]);
  assert.deepEqual(ids('', { status: 'available' }), ['both', 'legacy-only']);
  // The existence requirement is the filter's own statement: a property recording no address in
  // the selected format never matches, whatever else the record carries.
  assert.deepEqual(ids('BDS-current-only'), []);
  assert.deepEqual(ids('BDS-current-only', { addressFormat: 'current' }), [
    'current-only',
  ]);
  // Clearing the format filter widens the search to both recorded formats, so a property recorded in
  // only the other format stays reachable from the panel.
  assert.deepEqual(ids('', { addressFormat: 'any' }), [
    'both',
    'current-only',
    'legacy-only',
  ]);
  assert.deepEqual(ids('quan 1', { addressFormat: 'any' }), [
    'both',
    'legacy-only',
  ]);
  assert.deepEqual(ids('ben nghe', { addressFormat: 'any' }), [
    'both',
    'current-only',
  ]);
  assert.equal(matchesLocalFilters(onlyCurrent, noInventoryFilters), false);
  assert.equal(
    matchesLocalFilters(onlyCurrent, {
      ...noInventoryFilters,
      addressFormat: 'current',
    }),
    true,
  );
  assert.equal(
    matchesLocalFilters(onlyCurrent, {
      ...noInventoryFilters,
      addressFormat: 'any',
    }),
    true,
  );
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
