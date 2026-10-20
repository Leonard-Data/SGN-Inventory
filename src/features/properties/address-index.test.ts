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

test('only a text the page is not already showing filters the loaded catalogue locally', () => {
  // Typing a text the page is not showing is the local filter; the address box keeps the text it
  // was given, and the read behind the page is never rebuilt from it.
  assert.equal(localAddressQuery('le loi', '', null, 0), 'le loi');
  assert.equal(localAddressQuery('  le loi  ', '', null, 0), 'le loi');
  // The search the page is already showing is the server search over the whole inventory, so it is
  // not also filtered locally; whitespace alone is no search at all.
  assert.equal(localAddressQuery('le loi', 'le loi', null, 0), null);
  assert.equal(localAddressQuery(' le loi ', 'le loi', null, 0), null);
  assert.equal(localAddressQuery('   ', '', null, 0), null);
  // A chronological ordering or a filter set names a result set the loaded page cannot state, so
  // those keep the server search (issue #194).
  assert.equal(localAddressQuery('le loi', '', 'oldest', 0), null);
  assert.equal(localAddressQuery('le loi', '', 'newest', 0), null);
  assert.equal(localAddressQuery('le loi', '', null, 2), null);
  // Clearing a box whose page is showing a search filters the whole loaded page, which is not the
  // same as not filtering at all.
  assert.equal(localAddressQuery('', 'le loi', null, 0), '');
  assert.deepEqual(
    matchCatalogue(index, localAddressQuery('', 'le loi', null, 0)!),
    [LEGACY, BOTH, OTHER],
  );
});

test('a contiguous fragment is what matches, in the order it was recorded', () => {
  // Deliberate limit of this slice: matching is the contiguous, accent-insensitive fragment the
  // database's own address search documents. Token order, ranking, abbreviation expansion and
  // house-number structure belong to the matching slice (issue #191).
  assert.deepEqual(found('le loi'), ['2', '3']);
  assert.deepEqual(found('loi le'), []);
});
