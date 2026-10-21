import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAddressIndex,
  foldAddress,
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
// The same property with both stored formats, as the catalogue carries them. The old variant
// records the district and the current variant the province; neither is rebuilt from the other.
const BOTH = property('2', [
  address('legacy', '12/5 Lê Lợi, Phường 5, Quận 3', {
    houseNumber: '12/5',
    street: 'Lê Lợi',
    district: 'Quận 3',
  }),
  address('current', '12/5 Lê Lợi, Phường 5, Thành phố Hồ Chí Minh', {
    houseNumber: '12/5',
    street: 'Lê Lợi',
    commune: 'Phường 5',
  }),
]);
// The house number is not carried as a column here, so it is read out of the recorded text.
const LONGER = property('3', [
  address('legacy', '112 Lê Lợi, Phường 5, Quận 3'),
]);
const EXACT_MAIN = property('4', [
  address('legacy', '12 Lê Lợi, Phường 5, Quận 3', {
    houseNumber: '12',
    street: 'Lê Lợi',
    district: 'Quận 3',
  }),
]);
const LETTERED = property('5', [
  address('legacy', '12A Lê Lợi, Phường 5, Quận 3', {
    houseNumber: '12A',
    street: 'Lê Lợi',
    district: 'Quận 3',
  }),
]);
// A recorded street with no recorded house number: a number query must not find it.
const NO_NUMBER = property('6', [
  address('legacy', 'Nguyễn Văn Thương, Phường 25, Bình Thạnh', {
    street: 'Nguyễn Văn Thương',
    commune: 'Phường 25',
    district: 'Bình Thạnh',
  }),
]);
const DIACRITICS = property('7', [
  address('legacy', '99 Đồng Khởi, Phường Bến Nghé, Quận 1', {
    houseNumber: '99',
    street: 'Đồng Khởi',
    district: 'Quận 1',
  }),
]);

const RECORDS = [
  LEGACY,
  BOTH,
  LONGER,
  EXACT_MAIN,
  LETTERED,
  NO_NUMBER,
  DIACRITICS,
];
const index = buildAddressIndex(RECORDS);
const matches = (query: string) => matchCatalogue(index, query);
const found = (query: string) => matches(query).map((match) => match.record.id);

test('an address is compared without case, accents, đ or repeated whitespace', () => {
  assert.equal(foldAddress('  Nguyễn  Văn Thương '), 'nguyen van thuong');
  assert.equal(foldAddress('Đường Đồng Khởi'), 'duong dong khoi');
  assert.equal(foldAddress('12/5 Lê Lợi'), '12/5 le loi');
});

test('punctuation is standardized and only unambiguous abbreviations are expanded', () => {
  assert.equal(foldAddress('Nguyễn, Văn; Thương'), 'nguyen van thuong');
  assert.equal(foldAddress('P. 25'), 'phuong 25');
  assert.equal(foldAddress('Q.3'), 'quan 3');
  assert.equal(foldAddress('TP. Hồ Chí Minh'), 'thanh pho ho chi minh');
  assert.equal(foldAddress('KP. 5'), 'khu pho 5');
  // House-number structure is punctuation that survives normalization untouched.
  assert.equal(foldAddress('12A Lê Lợi'), '12a le loi');
});

test('accented and unaccented input match the same recorded address, and đ matches d', () => {
  assert.deepEqual(found('125 nguyen van thuong'), ['1']);
  assert.deepEqual(found('nguyễn văn thương'), ['1', '6']);
  assert.deepEqual(found('Bình Thạnh'), ['1', '6']);
  assert.deepEqual(found('dong khoi'), ['7']);
  assert.deepEqual(found('Đồng Khởi'), ['7']);
  // "Đường" is not in the recorded text, so it is not invented for the comparison.
  assert.deepEqual(found('duong dong khoi'), []);
  // The recorded text is kept for display: folding is only how the comparison is made.
  assert.equal(
    index[0]?.variants[0]?.addressText,
    LEGACY.addresses[0]?.addressText,
  );
  assert.equal(index[0]?.variants[0]?.format, 'legacy');
});

test('an expanded abbreviation finds the recorded name it stands for', () => {
  assert.deepEqual(found('p 25'), ['1', '6']);
  assert.deepEqual(found('phuong 25'), ['1', '6']);
  assert.deepEqual(found('q 3'), ['2', '3', '4', '5']);
  assert.deepEqual(found('quan 3'), ['2', '3', '4', '5']);
});

test('house numbers stay distinct: 12, 112 and 12/5 never collapse', () => {
  // The exact main number first, then the alley under it; 112 and 12A are neither.
  assert.deepEqual(found('12 le loi'), ['4', '2']);
  assert.deepEqual(found('112 le loi'), ['3']);
  assert.deepEqual(found('12/5 le loi'), ['2']);
  assert.deepEqual(found('12a le loi'), ['5']);
  // A bare main number still finds its exact property before the alley beneath it.
  assert.deepEqual(found('12'), ['4', '2']);
  // 112 is never presented as an exact match for 12, and it is not a candidate at all.
  assert.ok(!found('12 le loi').includes('3'));
});

test('a number query never finds a recorded street with no recorded number', () => {
  assert.deepEqual(found('125 nguyen van thuong'), ['1']);
  assert.ok(!found('99 nguyen van thuong').includes('6'));
});

test('either stored format finds the same property, and no query mixes them', () => {
  assert.deepEqual(found('thanh pho ho chi minh'), ['2']);
  // The district is recorded on the old address and the province on the current one; a query that
  // names one part of each matches neither, because each variant is searched on its own.
  assert.deepEqual(found('quan 3 ho chi minh'), []);
  // A property with two variants is one result, never two.
  assert.deepEqual(found('le loi'), ['2', '3', '4', '5']);
});

test('a result says which stored format matched', () => {
  assert.equal(matches('thanh pho ho chi minh')[0]?.format, 'current');
  assert.equal(matches('quan 3')[0]?.format, 'legacy');
  assert.equal(matches('12/5 le loi')[0]?.format, 'legacy');
});

test('the index is built once per property and holds every recorded variant', () => {
  assert.equal(index.length, RECORDS.length);
  assert.equal(index[0]?.variants.length, 1);
  assert.equal(index[1]?.variants.length, 2);
  assert.deepEqual(
    index[1]?.variants.map((variant) => variant.format),
    ['legacy', 'current'],
  );
});

test('every meaningful query token must match one variant', () => {
  assert.deepEqual(found('le loi quan 1'), []);
  assert.deepEqual(found('le loi quan 3'), ['2', '3', '4', '5']);
  // Tokens may arrive in a different order from the recorded one, but all must be present.
  assert.deepEqual(found('loi le'), ['2', '3', '4', '5']);
  assert.deepEqual(found('binh thanh 125 nguyen'), ['1']);
  assert.deepEqual(found('125 binh thanh nguyen van thuong'), ['1']);
});

test('a partial token matches as a prefix, an exact token ranks above a prefix', () => {
  const prefixed = buildAddressIndex([
    property('exact', [address('legacy', '1 An, Phường 1, Quận 1')]),
    property('prefix', [address('legacy', '1 Anh, Phường 1, Quận 1')]),
  ]);
  assert.deepEqual(
    matchCatalogue(prefixed, 'an').map((match) => match.record.id),
    ['exact', 'prefix'],
  );
  assert.deepEqual(
    matchCatalogue(prefixed, 'ng').map((match) => match.record.id),
    [],
  );
  assert.deepEqual(
    matchCatalogue(prefixed, 'an phuong').map((match) => match.record.id),
    ['exact', 'prefix'],
  );
});

test('ranking follows exact address, exact number and street, street and locality, then the rest', () => {
  // An exact whole-address match outranks an exact number-and-street match, whatever the identity.
  const ranked = buildAddressIndex([
    property('a', [
      address(
        'legacy',
        '125 Nguyễn Văn Thương, Phường 25, Bình Thạnh, Thành phố Hồ Chí Minh',
        {
          houseNumber: '125',
          street: 'Nguyễn Văn Thương',
          commune: 'Phường 25',
          district: 'Bình Thạnh',
        },
      ),
    ]),
    property('b', [
      address('legacy', '125 Nguyễn Văn Thương, Phường 25, Bình Thạnh', {
        houseNumber: '125',
        street: 'Nguyễn Văn Thương',
        commune: 'Phường 25',
        district: 'Bình Thạnh',
      }),
    ]),
  ]);
  assert.deepEqual(
    matchCatalogue(ranked, '125 nguyen van thuong phuong 25 binh thanh').map(
      (match) => match.record.id,
    ),
    ['b', 'a'],
  );
  // The whole recorded address is the exact match, with its own spelling preserved for display.
  assert.deepEqual(
    matchCatalogue(ranked, '125 nguyen van thuong').map(
      (match) => match.record.id,
    ),
    ['a', 'b'],
  );
  // Number and street beats street and locality beats a looser all-token match.
  assert.deepEqual(found('125 le loi'), []);
  assert.deepEqual(found('le loi quan 3'), ['2', '3', '4', '5']);
  assert.deepEqual(found('le loi'), ['2', '3', '4', '5']);
});

test('a property code is matched beside the address, and an exact code ranks first', () => {
  // The database's own text search matches the recorded property code beside the address, so the
  // browser matches it too instead of answering a code with an empty local result.
  const exactAddress = property('8', [address('legacy', 'Lê Lợi')]);
  const coded: PropertySummary = {
    ...property('9', [address('legacy', '99 Nguyễn Huệ')]),
    propertyCode: 'LE-LOI',
  };
  const numbered = property('7', [address('legacy', '7 Trần Hưng Đạo')]);
  const indexed = buildAddressIndex([exactAddress, coded, numbered]);
  const ids = (query: string) =>
    matchCatalogue(indexed, query).map((match) => match.record.id);
  // An exact code is the strongest result there is: above even an exactly recorded address that
  // states the same text.
  assert.deepEqual(ids('LE-LOI'), ['9', '8']);
  // A code typed in full finds its row, a fragment of it does, and neither claims a recorded
  // address format for the match.
  assert.deepEqual(ids('BDS-7'), ['7']);
  assert.deepEqual(ids('DS-7'), ['7']);
  assert.equal(matchCatalogue(indexed, 'BDS-7')[0]?.format, '');
});

test('the same search always returns the same order', () => {
  const reversed = buildAddressIndex([...RECORDS].reverse());
  assert.deepEqual(
    matchCatalogue(reversed, 'le loi').map((match) => match.record.id),
    matchCatalogue(index, 'le loi').map((match) => match.record.id),
  );
  assert.deepEqual(found('le loi'), ['2', '3', '4', '5']);
});

test('a query the loaded page does not answer is an empty result, never an error', () => {
  assert.deepEqual(found('đường không có trong danh mục'), []);
  assert.deepEqual(found('le loi quan 1'), []);
  // The whole loaded page is what an empty query is, not an empty result.
  assert.deepEqual(found(''), ['1', '2', '3', '4', '5', '6', '7']);
  assert.deepEqual(found('   '), ['1', '2', '3', '4', '5', '6', '7']);
  assert.deepEqual(matchCatalogue([], 'le loi'), []);
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
    assert.deepEqual(
      matchCatalogue(indexed, query).map((match) => match.record),
      [record],
      query,
    );
  assert.deepEqual(matchCatalogue(indexed, 'binh thanh phuong ben thanh'), []);
  assert.equal(indexed[0]?.variants[0]?.addressText, 'Địa chỉ gốc');
  assert.equal(indexed[0]?.variants[1]?.addressText, 'Địa chỉ hiện tại');
});
