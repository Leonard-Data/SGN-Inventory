import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAddressIndex,
  foldAddress,
  localAddressQuery,
  matchCatalogue,
} from './address-index.ts';
import type { AddressSummary, PropertySummary } from './types';

function address(
  format: string,
  addressText: string,
  parts: Partial<AddressSummary> = {},
): AddressSummary {
  return {
    id: `${format}-address`,
    format,
    addressText,
    mappingStatus: 'unresolved',
    isPrimary: format === 'legacy',
    houseNumber: null,
    street: null,
    commune: null,
    district: null,
    ...parts,
  };
}

function property(id: string, addresses: AddressSummary[]): PropertySummary {
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
    addresses,
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

// The captain's own example: an old address with a district and an unaccented query.
const LEGACY = property('1', [
  address('legacy', '125 Nguyễn Văn Thương, Phường 25, Bình Thạnh', {
    houseNumber: '125',
    street: 'Nguyễn Văn Thương',
    commune: 'Phường 25',
    district: 'Bình Thạnh',
  }),
]);
// The same property with both stored formats, as the catalogue carries them.
const BOTH = property('2', [
  address('legacy', '12/5 Lê Lợi, Phường 5, Quận 3', {
    houseNumber: '12/5',
    district: 'Quận 3',
  }),
  address('current', '12/5 Lê Lợi, Phường 5, Thành phố Hồ Chí Minh', {
    houseNumber: '12/5',
  }),
]);
const OTHER = property('3', [
  address('legacy', '112 Lê Lợi, Phường 5, Quận 3'),
]);

const index = buildAddressIndex([LEGACY, BOTH, OTHER]);
const found = (query: string) =>
  matchCatalogue(index, query).map((record) => record.id);

test('an address is compared without case, accents, đ or repeated whitespace', () => {
  assert.equal(foldAddress('  Nguyễn  Văn Thương '), 'nguyen van thuong');
  assert.equal(foldAddress('Đường Đồng Khởi'), 'duong dong khoi');
  assert.equal(foldAddress('12/5 Lê Lợi'), '12/5 le loi');
});

test('an unaccented query finds the accented recorded address', () => {
  assert.deepEqual(found('125 nguyen van thuong'), ['1']);
  assert.deepEqual(found('nguyễn văn thương'), ['1']);
  assert.deepEqual(found('Bình Thạnh'), ['1']);
  // The recorded text is kept for display: folding is only how the comparison is made.
  assert.equal(
    index[0]?.variants[0]?.addressText,
    LEGACY.addresses[0]?.addressText,
  );
  assert.equal(index[0]?.variants[0]?.format, 'legacy');
});

test('either stored format finds the same property, and no query mixes them', () => {
  assert.deepEqual(found('12/5 le loi'), ['2']);
  // The district is recorded on the old address and the province on the current one; a query that
  // names one part of each matches neither, because each variant is searched on its own.
  assert.deepEqual(found('quan 3 ho chi minh'), []);
  // A property with two variants is one result, never two.
  assert.deepEqual(found('le loi'), ['2', '3']);
  assert.equal(found('le loi').length, 2);
});

test('the index is built once per property and holds every recorded variant', () => {
  assert.equal(index.length, 3);
  assert.equal(index[0]?.variants.length, 1);
  assert.equal(index[1]?.variants.length, 2);
  assert.deepEqual(
    index[1]?.variants.map((variant) => variant.format),
    ['legacy', 'current'],
  );
});

test('a query the loaded page does not answer is an empty result, never an error', () => {
  assert.deepEqual(found('đường không có trong danh mục'), []);
  assert.deepEqual(found('le loi quan 1'), []);
  // The whole loaded page is what an empty query is, not an empty result.
  assert.deepEqual(found(''), ['1', '2', '3']);
  assert.deepEqual(found('   '), ['1', '2', '3']);
  assert.deepEqual(matchCatalogue([], 'le loi'), []);
});

test('an unedited or submitted search stays on its server result', () => {
  for (const query of ['', 'le loi', '  le loi  '])
    assert.equal(localAddressQuery(query, false, null, 0), null);
});

test('editing, restoring and clearing a basic search stays local until submission', () => {
  for (const [typed, expected, ids] of [
    ['le loi', 'le loi', ['2', '3']],
    ['  le loi  ', 'le loi', ['2', '3']],
    ['missing street', 'missing street', []],
    ['', '', ['1', '2', '3']],
    ['   ', '', ['1', '2', '3']],
    ['le loi', 'le loi', ['2', '3']],
  ] as const) {
    const query = localAddressQuery(typed, true, null, 0);
    assert.equal(query, expected);
    assert.deepEqual(
      matchCatalogue(index, query!).map((record) => record.id),
      ids,
    );
  }
  assert.equal(localAddressQuery('le loi', false, null, 0), null);
});

test('chronology and advanced filters keep the server result while typing', () => {
  for (const typed of ['le loi', '', '   ']) {
    assert.equal(localAddressQuery(typed, true, 'oldest', 0), null);
    assert.equal(localAddressQuery(typed, true, 'newest', 0), null);
    assert.equal(localAddressQuery(typed, true, null, 2), null);
  }
});

test('each variant indexes its carried address parts without changing its source text', () => {
  const record = property('parts', [
    address('legacy', 'Địa chỉ gốc', {
      houseNumber: '12A',
      street: 'Đồng Khởi',
      district: 'Bình Thạnh',
      commune: 'Phường 25',
    }),
    address('current', 'Địa chỉ hiện tại', {
      houseNumber: '12A',
      street: 'Đồng Khởi',
      commune: 'Phường Bến Thành',
    }),
  ]);
  const indexed = buildAddressIndex([record]);
  for (const query of [
    'dia chi goc',
    '12a',
    'dong khoi',
    '12a dong khoi',
    'binh thanh',
    'phuong 25',
    'phuong ben thanh',
  ])
    assert.deepEqual(matchCatalogue(indexed, query), [record], query);
  assert.deepEqual(matchCatalogue(indexed, 'binh thanh phuong ben thanh'), []);
  assert.equal(indexed[0]?.variants[0]?.addressText, 'Địa chỉ gốc');
  assert.equal(indexed[0]?.variants[1]?.addressText, 'Địa chỉ hiện tại');
});

test('a contiguous fragment is what matches, in the order it was recorded', () => {
  // Deliberate limit of this slice: matching is the contiguous, accent-insensitive fragment the
  // database's own address search documents. Token order, ranking, abbreviation expansion and
  // house-number structure belong to the matching slice (issue #191).
  assert.deepEqual(found('le loi'), ['2', '3']);
  assert.deepEqual(found('loi le'), []);
});
