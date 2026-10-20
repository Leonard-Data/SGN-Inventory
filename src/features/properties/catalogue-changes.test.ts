import assert from 'node:assert/strict';
import test from 'node:test';
import { matchCatalogue, type CatalogueIndexEntry } from './address-index.ts';
import {
  catalogueSummary,
  type CatalogueAddressRow,
  type CatalogueRow,
} from './catalogue.ts';
import {
  applyServerSummary,
  changedProperty,
  reconcileCatalogue,
  recordCatalogueChange,
  summaryChange,
  type CatalogueAnswer,
  type CatalogueChange,
} from './catalogue-changes.ts';
import { indexCataloguePage, startCatalogueLoad } from './catalogue-load.ts';
import type {
  AddressSummary,
  CataloguePage,
  PropertySummary,
} from './types.ts';

function address(
  id: string,
  addressText: string,
  parts: Partial<AddressSummary> = {},
): AddressSummary {
  return {
    id,
    format: 'legacy',
    addressText,
    mappingStatus: 'unresolved',
    isPrimary: true,
    houseNumber: null,
    street: null,
    commune: null,
    district: null,
    ...parts,
  };
}

function property(
  id: string,
  addresses: AddressSummary[],
  parts: Partial<PropertySummary> = {},
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
    ...parts,
  };
}

const AT = '2026-10-20T00:00:00.000Z';
const LATER = '2026-10-20T01:00:00.000Z';

// One address row as the catalogue read answers with it, including the version it supersedes.
function version(
  id: string,
  addressText: string,
  parts: Partial<CatalogueAddressRow> = {},
): CatalogueAddressRow {
  return {
    id,
    format: 'legacy',
    address_text: addressText,
    house_number: null,
    street: null,
    commune_text: null,
    district_text: null,
    is_primary: true,
    mapping_status: 'unresolved',
    supersedes_address_id: null,
    ...parts,
  };
}

// The summary one catalogue row states, so a fixture carries the rows the server really answers
// with rather than the summary a test wishes it answered with.
function summaryOf(
  id: string,
  addresses: CatalogueAddressRow[],
  parts: Partial<CatalogueRow> = {},
): PropertySummary {
  return catalogueSummary(
    {
      id,
      property_code: `BDS-${id}`,
      listing_mode: 'sale',
      status: 'available',
      property_type: 'house',
      sale_price_vnd: null,
      monthly_rent_vnd: null,
      land_area_m2: null,
      floor_area_m2: null,
      frontage_m: null,
      depth_m: null,
      floors: null,
      direction: null,
      access_type: null,
      cover_file_id: null,
      created_at: null,
      updated_at: null,
      created_by: null,
      property_addresses: addresses,
      ...parts,
    },
    null,
  );
}

// One property at its old address, as a page of the traversal answered with it.
const OLD = property('1', [
  address('1-legacy', '12 Lê Lợi, Phường 5, Quận 3', {
    houseNumber: '12',
    street: 'Lê Lợi',
    district: 'Quận 3',
  }),
]);
const OTHER = property('2', [
  address('2-legacy', '34 Nguyễn Huệ, Phường 1, Quận 1', {
    houseNumber: '34',
    street: 'Nguyễn Huệ',
    district: 'Quận 1',
  }),
]);
const page: CataloguePage = { properties: [OLD, OTHER], nextCursor: null };
const load = indexCataloguePage(startCatalogueLoad('generation-1'), page, AT);

// The property after a correction moved it: the database retained the version the correction
// replaced and inserted its replacement, so the server's own read answers with both rows.
const MOVED = summaryOf(
  '1',
  [
    version('1-legacy', '12 Lê Lợi, Phường 5, Quận 3', {
      house_number: '12',
      street: 'Lê Lợi',
      district_text: 'Quận 3',
      is_primary: false,
    }),
    version('1-current', '99 Hai Bà Trưng, Phường 6, Quận 3', {
      format: 'current',
      house_number: '99',
      street: 'Hai Bà Trưng',
      commune_text: 'Phường 6',
      supersedes_address_id: '1-legacy',
    }),
  ],
  { status: 'negotiating', updated_at: LATER },
);

function ids(index: readonly CatalogueIndexEntry[]): string[] {
  return index.map((entry) => entry.record.id);
}

function found(index: readonly CatalogueIndexEntry[], query: string) {
  return matchCatalogue(index, query).map((match) => match.record.id);
}

test('a server response replaces the cached summary and reindexes its address', () => {
  const reconciled = reconcileCatalogue(load.index, [
    { kind: 'upsert', summary: MOVED },
  ]);
  // The property is still one row, in the position it already held, holding the server's own
  // summary rather than what was submitted.
  assert.deepEqual(ids(reconciled), ['1', '2']);
  assert.equal(reconciled[0]?.record, MOVED);
  assert.equal(load.index.length, reconciled.length);
  // Search finds it under the current recorded address and no longer under the old one: the
  // entry's variants were folded again from the server's answer.
  assert.deepEqual(found(reconciled, '99 hai ba trung'), ['1']);
  assert.deepEqual(found(reconciled, '12 le loi'), []);
  // The untouched property keeps the entry the page produced.
  assert.equal(reconciled[1], load.index[1]);
});

test('the local filter and ranking follow the change', () => {
  const applied = recordCatalogueChange([], { kind: 'upsert', summary: MOVED });
  // The same page also holds an address beneath the number the query names, so the ranking of the
  // reconciled rows is observed rather than assumed.
  const alley = property(
    '0',
    [
      address('0-current', '99/7 Hai Bà Trưng, Phường 6, Quận 3', {
        format: 'current',
        houseNumber: '99/7',
        street: 'Hai Bà Trưng',
        commune: 'Phường 6',
      }),
    ],
    { updatedAt: LATER },
  );
  const loaded = indexCataloguePage(
    startCatalogueLoad('generation-2'),
    { properties: [OLD, OTHER, alley], nextCursor: null },
    LATER,
  );
  const reconciled = reconcileCatalogue(loaded.index, applied);
  // A typed query the old address answered is re-evaluated against the new one: a property that
  // no longer matches stops appearing, and one that now matches appears where its new address
  // ranks it rather than where the old address did.
  assert.deepEqual(found(loaded.index, 'le loi'), ['1']);
  assert.deepEqual(found(reconciled, 'le loi'), []);
  // The query already answered the address beneath the number; after the change the property that
  // moved onto the queried number outranks it, even though its identity sorts last, so the order
  // is the reconciled ranking rather than the identity order.
  assert.deepEqual(found(loaded.index, '99 hai ba trung'), ['0']);
  assert.deepEqual(found(reconciled, '99 hai ba trung'), ['1', '0']);
});

test('a create is appended and searchable without renumbering the loaded rows', () => {
  const created = property(
    '3',
    [
      address('3-current', '7 Pasteur, Phường 4, Quận 1', {
        format: 'current',
        houseNumber: '7',
        street: 'Pasteur',
      }),
    ],
    { updatedAt: LATER },
  );
  const reconciled = reconcileCatalogue(load.index, [
    { kind: 'upsert', summary: created },
  ]);
  assert.deepEqual(ids(reconciled), ['1', '2', '3']);
  assert.deepEqual(found(reconciled, '7 pasteur'), ['3']);
});

test('a removal drops the property and a later page cannot restore it', () => {
  const removal: CatalogueChange = { kind: 'remove', id: '1' };
  const reconciled = reconcileCatalogue(load.index, [removal]);
  assert.deepEqual(ids(reconciled), ['2']);
  assert.deepEqual(found(reconciled, 'le loi'), []);
  // The page that carried the property before it was removed, indexed again after the removal
  // (a retried batch or a replacement catalogue), is reconciled before it is read.
  const again = indexCataloguePage(
    startCatalogueLoad('generation-2'),
    page,
    LATER,
  );
  assert.deepEqual(ids(reconcileCatalogue(again.index, [removal])), ['2']);
});

test('a saved change survives the replacement catalogue it raced', () => {
  const applied = recordCatalogueChange([], { kind: 'upsert', summary: MOVED });
  // A replacement read that started before the save committed still carries the old row. It is
  // reconciled before it is swapped in, so the older answer never overwrites what was saved.
  const replacement = indexCataloguePage(
    startCatalogueLoad('generation-2'),
    page,
    LATER,
  );
  const swapped = reconcileCatalogue(replacement.index, applied);
  assert.equal(swapped[0]?.record, MOVED);
  assert.deepEqual(found(swapped, '99 hai ba trung'), ['1']);
  assert.deepEqual(found(swapped, '12 le loi'), []);
  // Out of order: the same rule holds when the last page arrives after the change.
  const lastBatch = indexCataloguePage(
    startCatalogueLoad('generation-2'),
    { properties: [OLD], nextCursor: null },
    LATER,
  );
  assert.equal(reconcileCatalogue(lastBatch.index, applied)[0]?.record, MOVED);
});

test('a read the server committed after the change is the newer authority', () => {
  const applied = recordCatalogueChange([], { kind: 'upsert', summary: MOVED });
  // The replacement carries the same property with a later modification time, so the server's
  // own revision decides: the read keeps its row instead of being rolled back to the saved one.
  const newer = property(
    '1',
    [
      address('1-current', '100 Hai Bà Trưng, Phường 6, Quận 3', {
        format: 'current',
        houseNumber: '100',
        street: 'Hai Bà Trưng',
      }),
    ],
    { updatedAt: '2026-10-20T02:00:00.000Z' },
  );
  const reconciled = reconcileCatalogue(
    indexCataloguePage(
      startCatalogueLoad('generation-2'),
      { properties: [newer, OTHER], nextCursor: null },
      LATER,
    ).index,
    applied,
  );
  assert.deepEqual(found(reconciled, '100 hai ba trung'), ['1']);
  assert.deepEqual(found(reconciled, '99 hai ba trung'), []);
});

test('the change log keeps one entry per property, latest last', () => {
  const first = recordCatalogueChange([], {
    kind: 'upsert',
    summary: MOVED,
  });
  const second = recordCatalogueChange(first, { kind: 'remove', id: '1' });
  const third = recordCatalogueChange(second, {
    kind: 'upsert',
    summary: property('1', OLD.addresses, { updatedAt: LATER }),
  });
  assert.equal(third.length, 1);
  const [latest] = third;
  assert.equal(latest && changedProperty(latest), '1');
  // The latest change is what is applied, so an upsert after a removal brings the property back
  // only when the server said it is readable again.
  assert.deepEqual(ids(reconcileCatalogue(load.index, third)), ['1', '2']);
  assert.deepEqual(ids(reconcileCatalogue(load.index, second)), ['2']);
});

test('a server answer states a change, a removal, or an unreadable summary', () => {
  assert.deepEqual(summaryChange(MOVED, '1'), {
    kind: 'upsert',
    summary: MOVED,
  });
  // The server answered that the property is no longer in the caller's catalogue.
  assert.deepEqual(summaryChange(null, '1'), { kind: 'remove', id: '1' });
  // The summary could not be read back, so the browser is told the change is unreconciled and
  // reads the catalogue again rather than keeping a row nothing confirms.
  assert.deepEqual(summaryChange(undefined, '1'), {
    kind: 'unreconciled',
    id: '1',
  });
});

test('a surface reports exactly what the server answered', () => {
  const answers: CatalogueAnswer[] = [];
  applyServerSummary((answer) => answers.push(answer), { summary: MOVED }, '1');
  assert.deepEqual(answers, [{ kind: 'upsert', summary: MOVED }]);
  // A response that carried no summary at all is reported as the committed change the server could
  // not read back, so the catalogue recovers instead of silently keeping what it held.
  applyServerSummary((answer) => answers.push(answer), {}, '1');
  assert.deepEqual(answers[1], { kind: 'unreconciled', id: '1' });
  // A response the server answered with null removes the row the server no longer carries.
  applyServerSummary((answer) => answers.push(answer), { summary: null }, '1');
  assert.deepEqual(answers[2], { kind: 'remove', id: '1' });
});

test('an unchanged catalogue is returned as it was read', () => {
  assert.equal(reconcileCatalogue(load.index, []), load.index);
});
