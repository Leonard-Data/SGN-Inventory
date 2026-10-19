import assert from 'node:assert/strict';
import test from 'node:test';
import { messages } from '../../i18n/messages.ts';
import {
  COLUMN_HEADINGS,
  MISSING_VALUE,
  propertyTableRow,
  rowPrice,
  TABLE_COLUMNS,
  totalAreaM2,
} from './table.ts';
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
