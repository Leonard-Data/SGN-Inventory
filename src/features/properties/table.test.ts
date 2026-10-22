import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { messages } from '../../i18n/messages.ts';
import {
  COLUMN_HEADINGS,
  listedAddress,
  MISSING_VALUE,
  propertyTableRow,
  recordFacts,
  rowPrice,
  SUMMARY_TABLE_COLUMNS,
  TABLE_COLUMNS,
  totalAreaM2,
} from './table.ts';
import { vietnamTimestamp } from './format.ts';
import type { PropertySummary } from './types.ts';

function record(overrides: Partial<PropertySummary> = {}): PropertySummary {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    propertyCode: 'SNH-0148',
    listingMode: 'sale',
    status: 'available',
    propertyType: 'house',
    salePriceVnd: '12500000000',
    monthlyRentVnd: null,
    createdAt: '2026-09-01T03:00:00Z',
    updatedAt: '2026-09-20T09:30:00Z',
    addresses: [],
    coverFileId: null,
    frontageM: '5',
    depthM: '18',
    landAreaM2: '90',
    floorAreaM2: '220',
    floors: 3,
    direction: 'east',
    accessType: 'car',
    createdBy: 'Nguyễn Thu Hà',
    updatedBy: 'Trần Văn Minh',
    ...overrides,
  };
}

const cell = (row: ReturnType<typeof propertyTableRow>, column: string) =>
  row.cells.find((entry) => entry.column === column)!;

test('the table carries exactly the ten asked-for columns in the asked-for order', () => {
  assert.deepEqual(TABLE_COLUMNS, [
    'propertyId',
    'createdDate',
    'price',
    'status',
    'houseNumber',
    'street',
    'ward',
    'district',
    'totalArea',
    'modifiedTime',
  ]);
  // Every column is labelled in both languages: a heading is never a bare key.
  for (const column of TABLE_COLUMNS) {
    assert.ok(COLUMN_HEADINGS[column], `${column} has no heading`);
    assert.ok(messages.vi[COLUMN_HEADINGS[column]].trim(), `${column} vi`);
    assert.ok(messages.en[COLUMN_HEADINGS[column]].trim(), `${column} en`);
  }
  const row = propertyTableRow(record(), 'vi');
  assert.deepEqual(
    row.cells.map((entry) => entry.column),
    [...TABLE_COLUMNS],
  );
});

test('a recorded row states every column, and the price is the emphasised cell', () => {
  const row = propertyTableRow(
    record({
      addresses: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          format: 'legacy',
          addressText: '12 Lê Lợi, Phường Bến Nghé, Quận 1',
          mappingStatus: 'unresolved',
          isPrimary: true,
          houseNumber: '12',
          street: 'Lê Lợi',
          commune: 'Phường Bến Nghé',
          district: 'Quận 1',
        },
      ],
    }),
    'vi',
  );
  assert.equal(cell(row, 'propertyId').text, 'SNH-0148');
  assert.equal(cell(row, 'status').text, messages.vi.available);
  assert.equal(cell(row, 'houseNumber').text, '12');
  assert.equal(cell(row, 'street').text, 'Lê Lợi');
  assert.equal(cell(row, 'ward').text, 'Phường Bến Nghé');
  assert.equal(cell(row, 'district').text, 'Quận 1');
  // The price is the strongest value: it is the one cell marked for emphasis, and it states the
  // unit it is counted in beside the number.
  assert.deepEqual(
    row.cells.filter((entry) => entry.emphasis).map((entry) => entry.column),
    ['price'],
  );
  assert.equal(cell(row, 'price').text, '12.500.000.000');
  assert.equal(cell(row, 'price').note, messages.vi.priceUnitVnd);
  assert.equal(cell(row, 'totalArea').text, '220');
  assert.equal(cell(row, 'totalArea').note, 'm²');
  // The row is named by the code and the recorded address it leads with.
  assert.equal(row.title, 'SNH-0148 · 12 Lê Lợi, Phường Bến Nghé, Quận 1');
  assert.equal(row.id, '11111111-1111-4111-8111-111111111111');
});

test('a value the record does not have renders as an em dash, never as a blank cell', () => {
  const row = propertyTableRow(
    record({
      salePriceVnd: null,
      monthlyRentVnd: null,
      floorAreaM2: null,
      landAreaM2: null,
      createdAt: null,
      updatedAt: null,
    }),
    'vi',
  );
  for (const column of [
    'price',
    'createdDate',
    'totalArea',
    'modifiedTime',
    'houseNumber',
    'street',
    'ward',
    'district',
  ])
    assert.equal(cell(row, column).text, MISSING_VALUE, column);
  assert.equal(MISSING_VALUE, '—');
  // A cell the record does have is never the marker.
  assert.equal(cell(row, 'propertyId').text, 'SNH-0148');
  // A current-format address records no district, so the marker says so rather than inventing
  // one or shortening the row.
  const current = propertyTableRow(
    record({
      addresses: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          format: 'current',
          addressText: '12 Lê Lợi, Phường Bến Nghé',
          mappingStatus: 'verified',
          isPrimary: true,
          houseNumber: '12',
          street: 'Lê Lợi',
          commune: 'Phường Bến Nghé',
          district: null,
        },
      ],
    }),
    'vi',
  );
  assert.equal(cell(current, 'district').text, MISSING_VALUE);
  assert.equal(cell(current, 'ward').text, 'Phường Bến Nghé');
});

// The row states the recorded address the search read it through, so a property recorded in both
// formats is listed with the format the search states rather than with whichever variant is primary.
test('a row states the recorded address the search read it through', () => {
  const current = {
    id: '33333333-3333-4333-8333-333333333333',
    format: 'current',
    addressText: '12 Lê Lợi, Phường Bến Nghé',
    mappingStatus: 'verified',
    isPrimary: false,
    houseNumber: '12',
    street: 'Lê Lợi',
    commune: 'Phường Bến Nghé',
    district: null,
  };
  const both = record({
    addresses: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        format: 'legacy',
        addressText: '12 Lê Lợi, Phường Bến Nghé, Quận 1',
        mappingStatus: 'unresolved',
        isPrimary: true,
        houseNumber: '12',
        street: 'Lê Lợi',
        commune: 'Phường Bến Nghé',
        district: 'Quận 1',
      },
      current,
    ],
  });
  const legacy = propertyTableRow(both, 'vi');
  assert.equal(cell(legacy, 'district').text, 'Quận 1');
  assert.match(legacy.title, /Quận 1/);
  const searched = propertyTableRow(
    both,
    'vi',
    null,
    listedAddress(both, 'current'),
  );
  assert.equal(cell(searched, 'ward').text, 'Phường Bến Nghé');
  // A current-format address records no district, so the cell says so rather than stating the
  // other format's district beside the current address.
  assert.equal(cell(searched, 'district').text, MISSING_VALUE);
  assert.equal(searched.title, 'SNH-0148 · 12 Lê Lợi, Phường Bến Nghé');
  // A cleared search states the recorded primary address, and the variant a query matched when
  // there is one, so the row's text and parts describe the address it is listed under.
  assert.equal(listedAddress(both, 'any'), both.addresses[0]);
  assert.equal(listedAddress(both, 'any', 'current'), current);
  const matched = propertyTableRow(
    both,
    'vi',
    null,
    listedAddress(both, 'any', 'current'),
  );
  assert.equal(cell(matched, 'district').text, MISSING_VALUE);
  assert.equal(matched.title, 'SNH-0148 · 12 Lê Lợi, Phường Bến Nghé');
  // A match that states no format, such as a property code alone, keeps the format the search reads
  // through instead of falling back to whichever variant was recorded first.
  assert.equal(listedAddress(both, 'legacy', ''), both.addresses[0]);
  assert.equal(listedAddress(both, 'current', ''), current);
  assert.equal(listedAddress(both, 'current'), current);
  assert.equal(listedAddress(both, null), both.addresses[0]);
});

// The list states these four facts in their own columns and the quick view states the same four
// as facts about the record, so both read this one projection and cannot disagree.
test('the summary table states frontage, depth, floors and the creator beside the area', () => {
  assert.deepEqual(SUMMARY_TABLE_COLUMNS, [
    'property',
    'address',
    'price',
    'totalArea',
    'frontage',
    'depth',
    'floors',
    'creator',
    'status',
    'modifiedTime',
    'actions',
  ]);
});

// The row draws its cells in the order the headings and the reserved colSpan count in, so a cell
// that drifted to another slot would label a whole column with the wrong fact.
test("the row draws its cells in the columns' own order", () => {
  const source = readFileSync(
    new URL('./property-table.tsx', import.meta.url),
    'utf8',
  );
  // Only the row itself: the heading row draws its columns from the list above.
  const row = source.slice(0, source.indexOf('function RecordMenu'));
  const drawn = [...row.matchAll(/data-column="([a-zA-Z]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(drawn, [...SUMMARY_TABLE_COLUMNS]);
});

test("the shared facts state each recorded value in the reader's own numbers", () => {
  const vi = recordFacts(record({ frontageM: '5.5', depthM: '18' }), 'vi');
  assert.deepEqual(vi.frontage, { text: '5,5 m', known: true });
  assert.deepEqual(vi.depth, { text: '18 m', known: true });
  assert.deepEqual(vi.floors, { text: '3', known: true });
  assert.deepEqual(vi.creator, { text: 'Nguyễn Thu Hà', known: true });
  assert.deepEqual(vi.modifier, { text: 'Trần Văn Minh', known: true });
  // English numbers keep the decimal point; the recorded name and the units do not change.
  const en = recordFacts(record({ frontageM: '5.5', depthM: '18' }), 'en');
  assert.equal(en.frontage.text, '5.5 m');
  assert.equal(en.depth.text, '18 m');
  // A thousands-separated floor count is still just a count.
  assert.equal(
    recordFacts(record({ floors: 1200 }), 'en').floors.text,
    '1,200',
  );
});

// A fact the record does not hold is the missing-value marker. Zero is a recorded number, so it is
// stated as one: an unknown frontage and a frontage of zero are different facts.
test('an unknown fact states the marker, and a recorded zero is not unknown', () => {
  const unknown = recordFacts(
    record({
      frontageM: null,
      depthM: null,
      floors: null,
      createdBy: null,
      updatedBy: null,
    }),
    'vi',
  );
  for (const [name, fact] of Object.entries(unknown))
    assert.deepEqual(fact, { text: MISSING_VALUE, known: false }, name);
  assert.equal(MISSING_VALUE, '—');

  const zero = recordFacts(
    record({
      frontageM: '0',
      depthM: '0',
      floors: 0,
      createdBy: '   ',
      updatedBy: '   ',
    }),
    'vi',
  );
  assert.deepEqual(zero.frontage, { text: '0 m', known: true });
  assert.deepEqual(zero.depth, { text: '0 m', known: true });
  assert.deepEqual(zero.floors, { text: '0', known: true });
  // A name of nothing but space is no name at all, for either attribution.
  assert.deepEqual(zero.creator, { text: MISSING_VALUE, known: false });
  assert.deepEqual(zero.modifier, { text: MISSING_VALUE, known: false });
});

test('total area is the floor area, falling back to the land area when it is absent', () => {
  assert.equal(totalAreaM2({ floorAreaM2: '220', landAreaM2: '90' }), '220');
  assert.equal(totalAreaM2({ floorAreaM2: null, landAreaM2: '90' }), '90');
  assert.equal(totalAreaM2({ floorAreaM2: '220', landAreaM2: null }), '220');
  assert.equal(totalAreaM2({ floorAreaM2: null, landAreaM2: null }), null);
  // The area is never a sum of the two, and the two are never both stated.
  assert.equal(totalAreaM2({ floorAreaM2: '220', landAreaM2: '90' }), '220');
});

test('the row price leads with the price the listing asks in, in its own unit', () => {
  assert.deepEqual(
    rowPrice({
      listingMode: 'rent',
      salePriceVnd: null,
      monthlyRentVnd: '25000000',
    }),
    { value: '25000000', unit: 'monthly' },
  );
  assert.deepEqual(
    rowPrice({
      listingMode: 'rent',
      salePriceVnd: '12300000000',
      monthlyRentVnd: '25000000',
    }),
    { value: '25000000', unit: 'monthly' },
  );
  assert.deepEqual(
    rowPrice({
      listingMode: 'sale',
      salePriceVnd: '12300000000',
      monthlyRentVnd: '25000000',
    }),
    { value: '12300000000', unit: 'vnd' },
  );
  // A record that holds only the other price states that price rather than nothing at all.
  assert.deepEqual(
    rowPrice({
      listingMode: 'rent',
      salePriceVnd: '12300000000',
      monthlyRentVnd: null,
    }),
    { value: '12300000000', unit: 'vnd' },
  );
  assert.deepEqual(
    rowPrice({
      listingMode: 'sale',
      salePriceVnd: null,
      monthlyRentVnd: '25000000',
    }),
    { value: '25000000', unit: 'monthly' },
  );
  assert.equal(
    rowPrice({ listingMode: 'sale', salePriceVnd: null, monthlyRentVnd: null }),
    null,
  );
  // The unit is the localized copy, and a rental row states the monthly unit.
  const rent = propertyTableRow(
    record({
      listingMode: 'rent',
      salePriceVnd: null,
      monthlyRentVnd: '25000000',
    }),
    'en',
  );
  assert.equal(cell(rent, 'price').note, messages.en.priceUnitMonthly);
  assert.equal(cell(rent, 'price').text, '25,000,000');
});

test('the modified cell reads as how long ago, and keeps the exact recorded time', () => {
  const updated = '2026-09-20T09:30:00Z';
  const row = propertyTableRow(
    record({ updatedAt: updated }),
    'vi',
    Date.parse(updated) + 5 * 60_000,
  );
  assert.equal(cell(row, 'modifiedTime').text, '5 phút trước');
  // The precise moment is still on the cell, so the phrase never costs the recorded time.
  assert.equal(
    cell(row, 'modifiedTime').title,
    vietnamTimestamp(updated, 'vi'),
  );
  // Before the browser's clock has answered, the cell states the recorded timestamp itself.
  assert.equal(
    cell(propertyTableRow(record({ updatedAt: updated }), 'en'), 'modifiedTime')
      .text,
    vietnamTimestamp(updated, 'en'),
  );
  // A record with no modified time is the missing-value marker, with no time to keep behind it.
  const unknown = propertyTableRow(
    record({ updatedAt: null }),
    'vi',
    Date.now(),
  );
  assert.equal(cell(unknown, 'modifiedTime').text, MISSING_VALUE);
  assert.equal(cell(unknown, 'modifiedTime').title, undefined);
});
