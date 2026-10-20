import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATALOGUE_PAGE_SIZE,
  CATALOGUE_SELECT,
  catalogueFailure,
  catalogueRequest,
  catalogueSummary,
  nextCatalogueCursor,
  parseCatalogueCursor,
  type CatalogueRow,
} from './catalogue.ts';

const PROPERTY_ID = '3f1c1f0e-2a4b-4c5d-8e6f-7a8b9c0d1e2f';
const SECOND_ID = '8b2d3e4f-5a6b-4c7d-9e8f-1a2b3c4d5e6f';

// One row as the read's own select list shapes it: the summary fields with the address variants
// flattened into the row, money and measurements already cast to text.
const row: CatalogueRow = {
  id: PROPERTY_ID,
  property_code: 'BDS-0001',
  listing_mode: 'sale',
  status: 'available',
  property_type: 'house',
  sale_price_vnd: '12500000000',
  monthly_rent_vnd: null,
  land_area_m2: '85.50',
  floor_area_m2: null,
  frontage_m: '5.00',
  depth_m: '17.10',
  floors: 3,
  direction: 'SE',
  access_type: 'car_alley',
  cover_file_id: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-19T04:00:00Z',
  property_addresses: [
    {
      id: SECOND_ID,
      format: 'legacy',
      address_text: '125 Nguyễn Văn Thương, Phường 25, Bình Thạnh',
      house_number: '125',
      street: 'Nguyễn Văn Thương',
      commune_text: 'Phường 25',
      district_text: 'Bình Thạnh',
      is_primary: true,
      mapping_status: 'unresolved',
    },
    {
      id: PROPERTY_ID,
      format: 'current',
      address_text: '125 Nguyễn Văn Thương, Phường 25, Thành phố Hồ Chí Minh',
      house_number: '125',
      street: 'Nguyễn Văn Thương',
      commune_text: 'Phường 25',
      district_text: null,
      is_primary: false,
      mapping_status: 'candidate',
    },
  ],
};

// The fields the read's own select list names, with the cast each one states and the embedded
// address resource counted as one field. Parsing it means the assertion is about the contract the
// read states rather than about the text that states it.
function selected(select: string): Map<string, string | null> {
  const fields = new Map<string, string | null>();
  let depth = 0;
  let current = '';
  const flush = () => {
    const [name, cast] = current.trim().split('::');
    const field = name?.split('(')[0]?.trim();
    if (field) fields.set(field, cast ?? null);
    current = '';
  };
  for (const character of select) {
    if (character === '(') depth++;
    if (character === ')') depth--;
    if (character === ',' && depth === 0) {
      flush();
      continue;
    }
    current += character;
  }
  flush();
  return fields;
}

test('the catalogue read names the summary contract and casts its money and measurements', () => {
  const fields = selected(CATALOGUE_SELECT);
  // Exactly this set: contacts, legal fields, notes, coordinates, the creator and the entry
  // chronology belong to the detail and chronological reads, which authorize them separately.
  assert.deepEqual([...fields.keys()].sort(), [
    'access_type',
    'cover_file_id',
    'created_at',
    'depth_m',
    'direction',
    'floor_area_m2',
    'floors',
    'frontage_m',
    'id',
    'land_area_m2',
    'listing_mode',
    'monthly_rent_vnd',
    'property_addresses',
    'property_code',
    'property_type',
    'sale_price_vnd',
    'status',
    'updated_at',
  ]);
  // Money and measurements are cast before serialization, so no numeric(18,0) or m² value is
  // rounded through a JavaScript number; every other field is stated as its own type.
  for (const money of [
    'sale_price_vnd',
    'monthly_rent_vnd',
    'land_area_m2',
    'floor_area_m2',
    'frontage_m',
    'depth_m',
  ])
    assert.equal(fields.get(money), 'text', money);
  for (const field of [
    'id',
    'property_code',
    'listing_mode',
    'status',
    'property_type',
    'floors',
    'direction',
    'access_type',
    'cover_file_id',
    'created_at',
    'updated_at',
    'property_addresses',
  ])
    assert.equal(fields.get(field), null, field);
});

test('one row becomes the list summary, with the recorded text and both formats', () => {
  const summary = catalogueSummary(row);
  assert.deepEqual(Object.keys(summary).sort(), [
    'accessType',
    'addresses',
    'coverFileId',
    'createdAt',
    'createdBy',
    'depthM',
    'direction',
    'floorAreaM2',
    'floors',
    'frontageM',
    'id',
    'landAreaM2',
    'listingMode',
    'monthlyRentVnd',
    'propertyCode',
    'propertyType',
    'salePriceVnd',
    'status',
    'updatedAt',
  ]);
  assert.equal(summary.salePriceVnd, '12500000000');
  assert.equal(summary.landAreaM2, '85.50');
  assert.equal(summary.propertyCode, 'BDS-0001');
  // The primary address is the one the card draws, and the legacy text is kept exactly as
  // recorded: a current address is never rebuilt from it and the old one is never overwritten.
  assert.equal(summary.addresses[0]?.format, 'legacy');
  assert.equal(
    summary.addresses[0]?.addressText,
    '125 Nguyễn Văn Thương, Phường 25, Bình Thạnh',
  );
  assert.equal(summary.addresses[1]?.format, 'current');
  assert.equal(summary.addresses[1]?.district, null);
  // The catalogue states no attribution and no entry chronology.
  assert.equal(summary.createdBy, null);
  assert.equal(summary.entryOn, undefined);
});

test('a row with no address or no facts states the gap rather than inventing one', () => {
  const summary = catalogueSummary({
    ...row,
    sale_price_vnd: null,
    floors: null,
    property_addresses: null,
  });
  assert.deepEqual(summary.addresses, []);
  assert.equal(summary.salePriceVnd, null);
  assert.equal(summary.floors, null);
});

const cursor = (values: Record<string, string>) =>
  parseCatalogueCursor(new URLSearchParams(values));

test('an absent cursor is the first page and a mangled one is refused', () => {
  assert.deepEqual(cursor({}), { ok: true, after: null });
  assert.deepEqual(cursor({ after: '' }), { ok: true, after: null });
  assert.deepEqual(cursor({ after: PROPERTY_ID }), {
    ok: true,
    after: PROPERTY_ID,
  });
  // The cursor is a position in one ordering, so a value that names no position is refused rather
  // than read as a different page.
  for (const value of [
    '1',
    'not-a-uuid',
    `${PROPERTY_ID} or true`,
    `${PROPERTY_ID} `,
    PROPERTY_ID.toUpperCase() + 'x',
  ])
    assert.deepEqual(cursor({ after: value }), { ok: false }, `after=${value}`);
});

test('the next cursor is the last identity of a full page only', () => {
  // A short page ends the traversal: there is no position after it to state.
  assert.equal(nextCatalogueCursor([PROPERTY_ID]), null);
  assert.equal(nextCatalogueCursor([]), null);
  const full = Array.from(
    { length: CATALOGUE_PAGE_SIZE },
    (_, index) =>
      `${String(index).padStart(8, '0')}-0000-0000-0000-000000000000`,
  );
  assert.equal(nextCatalogueCursor(full), full[full.length - 1]);
});

test('the read answers one cursor and nothing else in the address', () => {
  const ask = (values: Record<string, string>) =>
    catalogueRequest(new URLSearchParams(values));
  assert.deepEqual(ask({}), { ok: true, after: null });
  assert.deepEqual(ask({ after: PROPERTY_ID }), {
    ok: true,
    after: PROPERTY_ID,
  });
  // The catalogue read has no filters, no ordering and no page size of its own: a caller that
  // sends one is refused rather than answered with a page it did not ask for.
  for (const values of [
    { query: 'le loi' },
    { limit: '500' },
    { page: '2' },
    { after: 'nonsense' },
    { after: PROPERTY_ID, query: '' },
  ] as Record<string, string>[])
    assert.deepEqual(ask(values), { ok: false }, JSON.stringify(values));
});

test('a refused read answers a refusal, never an empty catalogue', () => {
  // Row level security denies a read the caller may not make; that is a refusal, not an inventory
  // that happens to hold no properties.
  assert.deepEqual(catalogueFailure('42501'), {
    status: 403,
    code: 'access-denied',
  });
  // Any other failure is unavailable, so a caller is never shown an empty page as an answer.
  for (const code of ['57014', 'PGRST301', undefined])
    assert.deepEqual(
      catalogueFailure(code),
      { status: 503, code: 'unavailable' },
      `code=${String(code)}`,
    );
});
