import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATALOGUE_PAGE_SIZE,
  CATALOGUE_SELECT,
  catalogueFailure,
  catalogueKeyset,
  catalogueRequest,
  catalogueSummary,
  nextCatalogueCursor,
  parseCatalogueCursor,
  supersededAddressIds,
  type CatalogueRow,
} from './catalogue.ts';

const PROPERTY_ID = '3f1c1f0e-2a4b-4c5d-8e6f-7a8b9c0d1e2f';
const SECOND_ID = '8b2d3e4f-5a6b-4c7d-9e8f-1a2b3c4d5e6f';
const THIRD_ID = '9c3e4f50-6b7c-4d8e-9f0a-2b3c4d5e6f70';

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
  created_by: SECOND_ID,
  updated_by: THIRD_ID,
  property_addresses: [
    {
      id: SECOND_ID,
      format: 'legacy',
      address_text: '125 Nguyễn Văn Thương, Phường 25, Bình Thạnh',
      house_number: '125',
      street: 'Nguyễn Văn Thương',
      commune_text: 'Phường 25',
      district_text: 'Bình Thạnh',
      province: { name_vi: 'Thành phố Hồ Chí Minh' },
      district: { name_vi: 'Bình Thạnh' },
      commune: { name_vi: 'Phường 25' },
      is_primary: true,
      mapping_status: 'unresolved',
      supersedes_address_id: null,
    },
    {
      id: PROPERTY_ID,
      format: 'current',
      address_text: '125 Nguyễn Văn Thương, Phường 25, Thành phố Hồ Chí Minh',
      house_number: '125',
      street: 'Nguyễn Văn Thương',
      commune_text: 'Phường 25',
      district_text: null,
      province: { name_vi: 'Thành phố Hồ Chí Minh' },
      district: null,
      commune: { name_vi: 'Phường 25' },
      is_primary: false,
      mapping_status: 'candidate',
      supersedes_address_id: null,
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
  // Exactly this set: contacts, legal fields, notes, coordinates and the entry chronology belong
  // to the detail and chronological reads, which authorize them separately. The creator reference
  // is carried so the ordinary browse keeps its attribution.
  assert.deepEqual([...fields.keys()].sort(), [
    'access_type',
    'cover_file_id',
    'created_at',
    'created_by',
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
    'updated_by',
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
    'created_by',
    'updated_at',
    'updated_by',
    'property_addresses',
  ])
    assert.equal(fields.get(field), null, field);
});

test('one row becomes the list summary, with the recorded text and both formats', () => {
  const summary = catalogueSummary(row, 'Nguyễn Thu Hà', 'Trần Văn Minh');
  assert.deepEqual(Object.keys(summary).sort(), [
    'accessType',
    'addresses',
    'coverFileId',
    'createdAt',
    'createdBy',
    'createdById',
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
    'updatedBy',
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
  // The official names of the units each variant chose ride beside the recorded text, largest tier
  // first and without a level the address did not record, so the address index can match them.
  assert.deepEqual(summary.addresses[0]?.units, [
    'Thành phố Hồ Chí Minh',
    'Bình Thạnh',
    'Phường 25',
  ]);
  assert.deepEqual(summary.addresses[1]?.units, [
    'Thành phố Hồ Chí Minh',
    'Phường 25',
  ]);
  // The creator the page resolved rides on the summary, so the ordinary browse keeps the
  // attribution the stream read used to supply; the catalogue states no entry chronology.
  assert.equal(summary.createdBy, 'Nguyễn Thu Hà');
  // The creator's identity rides on the summary beside the name, so a "created by me" filter
  // compares who created the record rather than the name two colleagues can share.
  assert.equal(summary.createdById, SECOND_ID);
  // The modifier's resolved name rides on the same summary, so the quick view states both
  // attributions without a read of its own.
  assert.equal(summary.updatedBy, 'Trần Văn Minh');
  assert.equal(summary.entryOn, undefined);
});

test('a superseded address version is history, not part of the summary', () => {
  const replaced = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
  const replacement = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
  const summary = catalogueSummary(
    {
      ...row,
      property_addresses: [
        {
          id: replaced,
          format: 'legacy',
          address_text: '12 Lê Lợi, Phường 5, Quận 3',
          house_number: '12',
          street: 'Lê Lợi',
          commune_text: 'Phường 5',
          district_text: 'Quận 3',
          province: null,
          district: null,
          commune: null,
          is_primary: false,
          mapping_status: 'unresolved',
          supersedes_address_id: null,
        },
        {
          id: replacement,
          format: 'legacy',
          address_text: '99 Hai Bà Trưng, Phường 6, Quận 3',
          house_number: '99',
          street: 'Hai Bà Trưng',
          commune_text: 'Phường 6',
          district_text: 'Quận 3',
          province: null,
          district: null,
          commune: null,
          is_primary: true,
          mapping_status: 'unresolved',
          supersedes_address_id: replaced,
        },
        {
          id: PROPERTY_ID,
          format: 'alternate',
          address_text: '99 Hai Bà Trưng, Phường 6, Quận 3 (hẻm 7)',
          house_number: '99',
          street: 'Hai Bà Trưng',
          commune_text: 'Phường 6',
          district_text: 'Quận 3',
          province: null,
          district: null,
          commune: null,
          is_primary: false,
          mapping_status: 'unresolved',
          supersedes_address_id: null,
        },
      ],
    },
    null,
  );
  // The retained row the replacement superseded is not folded into the summary, while the current
  // recorded address and a variant nobody superseded both are.
  assert.deepEqual(
    summary.addresses.map((address) => address.id),
    [replacement, PROPERTY_ID],
  );
});

test('only a row a later same-format correction replaced counts as superseded', () => {
  const legacy = '4e5f6071-8b9c-4d0e-9f1a-3c4d5e6f7081';
  const correctedLegacy = '5f607182-9c0d-4e1f-8a2b-4d5e6f708192';
  const candidate = '60718293-0d1e-4f20-9b3c-5e6f70819203';
  const superseded = supersededAddressIds([
    { id: legacy, format: 'legacy', supersedes_address_id: null },
    {
      id: correctedLegacy,
      format: 'legacy',
      supersedes_address_id: legacy,
    },
    {
      id: candidate,
      format: 'current',
      supersedes_address_id: correctedLegacy,
    },
  ]);
  // Only the corrected-away legacy row is history, so its format switch is no longer offered; the
  // row the property is recorded at and the current row recorded from it both still are.
  assert.deepEqual([...superseded], [legacy]);
  assert.equal(superseded.has(correctedLegacy), false);
  assert.equal(superseded.has(candidate), false);
});

test('a current address recorded from a legacy one keeps the legacy row in the summary', () => {
  const legacy = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
  const candidate = '3d4e5f60-7a8b-4c9d-8e0f-2b3c4d5e6f70';
  const summary = catalogueSummary(
    {
      ...row,
      property_addresses: [
        {
          id: legacy,
          format: 'legacy',
          address_text: '12 Lê Lợi, Phường 5, Quận 3',
          house_number: '12',
          street: 'Lê Lợi',
          commune_text: 'Phường 5',
          district_text: 'Quận 3',
          province: null,
          district: null,
          commune: null,
          is_primary: true,
          mapping_status: 'unresolved',
          supersedes_address_id: null,
        },
        {
          id: candidate,
          format: 'current',
          address_text: '12 Lê Lợi, Phường Bến Thành, Thành phố Hồ Chí Minh',
          house_number: '12',
          street: 'Lê Lợi',
          commune_text: 'Phường Bến Thành',
          district_text: null,
          province: null,
          district: null,
          commune: null,
          is_primary: true,
          mapping_status: 'candidate',
          supersedes_address_id: legacy,
        },
      ],
    },
    null,
  );
  // The legacy row is where the property is still recorded, not a version the candidate replaced:
  // both stay primary and searchable in their own format.
  assert.deepEqual(
    summary.addresses.map((address) => address.id + ':' + address.format),
    [legacy + ':legacy', candidate + ':current'],
  );
});

test('a row with no address or no facts states the gap rather than inventing one', () => {
  const summary = catalogueSummary(
    {
      ...row,
      sale_price_vnd: null,
      floors: null,
      property_addresses: null,
    },
    null,
  );
  assert.deepEqual(summary.addresses, []);
  assert.equal(summary.salePriceVnd, null);
  assert.equal(summary.floors, null);
  // A creator that did not resolve states nothing at all, exactly as the stream's attribution does.
  assert.equal(summary.createdBy, null);
});

const cursor = (values: Record<string, string>) =>
  parseCatalogueCursor(new URLSearchParams(values));
const CHANGED_AT = '2026-10-22T08:51:10.369123+00:00';
const CURSOR = `${CHANGED_AT}|${PROPERTY_ID}`;

test('an absent cursor is the first page and a mangled one is refused', () => {
  assert.deepEqual(cursor({}), { ok: true, after: null });
  // The change time is carried as the read stated it, minute and microsecond alike: rounding it
  // would move the position past rows the page never carried.
  assert.deepEqual(cursor({ after: CURSOR }), {
    ok: true,
    after: { updatedAt: CHANGED_AT, id: PROPERTY_ID },
  });
  // The cursor is a position in one ordering, so a value that names no position is refused rather
  // than read as a different page.
  for (const value of [
    '',
    '1',
    'not-a-uuid',
    PROPERTY_ID,
    `${CHANGED_AT}|`,
    `${CHANGED_AT}|not-a-uuid`,
    `${CHANGED_AT}|${PROPERTY_ID}|extra`,
    `not-a-date|${PROPERTY_ID}`,
    // A form the legacy date parser accepts but the read's own timestamp grammar refuses, so the
    // value cannot carry filter characters into the keyset.
    `Thu, 22 Oct 2026 00:00:00 GMT" (x)|${PROPERTY_ID}`,
    `2026-13-45T00:00:00+00:00|${PROPERTY_ID}`,
    `${CHANGED_AT}|${PROPERTY_ID} or true`,
    `${CHANGED_AT}|${PROPERTY_ID} `,
    `${CHANGED_AT}|${PROPERTY_ID.toUpperCase()}x`,
  ])
    assert.deepEqual(cursor({ after: value }), { ok: false }, `after=${value}`);
});

test('the keyset for a position states the change time and the identity it continues from', () => {
  // An earlier change time comes first; the same instant is decided by a lower identity. Both
  // terms repeat the read's own value quoted, so one timestamp is not read as filter grammar.
  assert.equal(
    catalogueKeyset({ updatedAt: CHANGED_AT, id: PROPERTY_ID }),
    `updated_at.lt."${CHANGED_AT}",and(updated_at.eq."${CHANGED_AT}",id.lt."${PROPERTY_ID}")`,
  );
});

test('the next cursor is the last position of a full page only', () => {
  // A short page ends the traversal: there is no position after it to state.
  assert.equal(
    nextCatalogueCursor([{ id: PROPERTY_ID, updatedAt: CHANGED_AT }]),
    null,
  );
  assert.equal(nextCatalogueCursor([]), null);
  const full = Array.from({ length: CATALOGUE_PAGE_SIZE }, (_, index) => ({
    id: `${String(index).padStart(8, '0')}-0000-0000-0000-000000000000`,
    updatedAt: CHANGED_AT,
  }));
  assert.equal(
    nextCatalogueCursor(full),
    `${CHANGED_AT}|${full[full.length - 1]?.id}`,
  );
  // A page whose last row states no change time cannot state a position after it.
  assert.equal(
    nextCatalogueCursor(
      full.map((row, index) =>
        index === full.length - 1 ? { ...row, updatedAt: null } : row,
      ),
    ),
    null,
  );
});

test('the read answers one cursor and nothing else in the address', () => {
  const ask = (values: Record<string, string>) =>
    catalogueRequest(new URLSearchParams(values));
  assert.deepEqual(ask({}), { ok: true, after: null });
  assert.deepEqual(ask({ after: CURSOR }), {
    ok: true,
    after: { updatedAt: CHANGED_AT, id: PROPERTY_ID },
  });
  // The catalogue read has no filters, no ordering and no page size of its own: a caller that
  // sends one is refused rather than answered with a page it did not ask for.
  for (const values of [
    { query: 'le loi' },
    { limit: '500' },
    { page: '2' },
    { after: '' },
    { after: 'nonsense' },
    { after: CURSOR, query: '' },
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
