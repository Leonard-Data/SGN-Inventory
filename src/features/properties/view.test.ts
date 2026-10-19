import assert from 'node:assert/strict';
import test from 'node:test';
import { noInventoryFilters, type InventoryFilters } from './filters.ts';
import {
  CARD_CHUNK_ROWS,
  cardChunkRows,
  cardColumns,
  inventoryHref,
  parseInventoryView,
  PHONE_MAX_WIDTH_PX,
} from './view.ts';

const view = (value: string | null) => parseInventoryView(value);

test('the view the address states is cards, table, or a refusal', () => {
  assert.deepEqual(view(null), { ok: true, view: 'cards' });
  assert.deepEqual(view(''), { ok: true, view: 'cards' });
  assert.deepEqual(view('cards'), { ok: true, view: 'cards' });
  assert.deepEqual(view('table'), { ok: true, view: 'table' });
  for (const value of ['Table', 'TABLE', 'grid', 'list', 'table ', ' cards'])
    assert.deepEqual(view(value), { ok: false }, `view=${value}`);
});

test('switching the view keeps the search, the ordering and the filters', () => {
  const filters: InventoryFilters = {
    ...noInventoryFilters,
    status: 'available',
    mode: 'sale',
    priceMin: '1000000',
    province: '50000000-0000-4000-8000-000000000001',
  };
  const table = inventoryHref({
    query: 'le loi',
    sort: 'newest',
    view: 'table',
    filters,
  });
  assert.deepEqual(
    [...new URLSearchParams(table.split('?')[1]).entries()].sort(),
    [
      ['mode', 'sale'],
      ['priceMin', '1000000'],
      ['province', '50000000-0000-4000-8000-000000000001'],
      ['query', 'le loi'],
      ['sort', 'newest'],
      ['status', 'available'],
      ['view', 'table'],
    ],
  );
  // Back to cards: the same result set, and the default view leaves the address short.
  const cards = inventoryHref({
    query: 'le loi',
    sort: 'newest',
    view: 'cards',
    filters,
  });
  assert.equal(cards.includes('view='), false);
  assert.deepEqual(
    [...new URLSearchParams(cards.split('?')[1]).keys()].sort(),
    ['mode', 'priceMin', 'province', 'query', 'sort', 'status'],
  );
  // The default ordering leaves its own parameter out too, exactly as before.
  const plain = inventoryHref({
    query: '',
    sort: null,
    view: 'cards',
    filters: noInventoryFilters,
  });
  assert.equal(plain, '/properties?query=');
});

test('the card grid holds the columns the package’s own auto-fill tracks fit', () => {
  // Phone width is one column whatever the 300px minimum says: below the breakpoint the grid is
  // the list's single column, exactly as the stylesheet settles it.
  assert.equal(cardColumns(320), 1);
  assert.equal(cardColumns(PHONE_MAX_WIDTH_PX), 1);
  assert.equal(cardColumns(PHONE_MAX_WIDTH_PX + 1), 2);
  // Above the breakpoint the arithmetic is the browser's: whole 300px tracks plus the 20px gap.
  assert.equal(cardColumns(619), 1);
  assert.equal(cardColumns(940), 3);
  assert.equal(cardColumns(1280), 4);
  // A width that is not a number cannot invent columns.
  assert.equal(cardColumns(Number.NaN), 1);
  assert.equal(cardColumns(0), 1);
});

test('a card chunk is whole grid rows of the measured columns', () => {
  assert.equal(cardChunkRows(1), CARD_CHUNK_ROWS);
  assert.equal(cardChunkRows(3), 9);
  assert.equal(cardChunkRows(4), 12);
  // A fractional or zero measurement still yields whole cards and at least one row.
  assert.equal(cardChunkRows(2.7), 6);
  assert.equal(cardChunkRows(0), CARD_CHUNK_ROWS);
  assert.equal(cardChunkRows(3, 0), 3);
});
