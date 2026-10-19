import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { messages } from '../../i18n/messages.ts';
import { noInventoryFilters, type InventoryFilters } from './filters.ts';
import {
  CARD_CHUNK_ROWS,
  cardChunkRows,
  cardColumns,
  DEFAULT_INVENTORY_VIEW,
  inventoryHref,
  inventoryViewParam,
  parseInventoryView,
  PHONE_MAX_WIDTH_PX,
  shownInventoryView,
} from './view.ts';

const view = (value: string | null) => parseInventoryView(value);

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

const inventory = source('./inventory.tsx');
const surfaces = source('../../app/sgn-surfaces.css');

test('a visit with no view in the address lands on the table', () => {
  assert.equal(DEFAULT_INVENTORY_VIEW, 'table');
  assert.deepEqual(view(null), { ok: true, view: 'table' });
  assert.deepEqual(view(''), { ok: true, view: 'table' });
  assert.deepEqual(view('cards'), { ok: true, view: 'cards' });
  assert.deepEqual(view('table'), { ok: true, view: 'table' });
  for (const value of ['Table', 'TABLE', 'grid', 'list', 'table ', ' cards'])
    assert.deepEqual(view(value), { ok: false }, `view=${value}`);
});

// The card view is one click away on the table, and a phone is never put on a table it cannot
// operate: the viewport decides, not the address alone.
test('a phone-width visit resolves to cards whatever the address asks for', () => {
  assert.equal(shownInventoryView('table', true), 'table');
  assert.equal(shownInventoryView('cards', true), 'cards');
  assert.equal(shownInventoryView('table', false), 'cards');
  assert.equal(shownInventoryView('cards', false), 'cards');
  // Only the view that differs from the default is written into the address.
  assert.equal(inventoryViewParam('table'), null);
  assert.equal(inventoryViewParam('cards'), 'cards');
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
    ],
  );
  // One click to cards: the same result set, and the non-default view is stated in the address.
  const cards = inventoryHref({
    query: 'le loi',
    sort: 'newest',
    view: 'cards',
    filters,
  });
  assert.deepEqual(
    [...new URLSearchParams(cards.split('?')[1]).keys()].sort(),
    ['mode', 'priceMin', 'province', 'query', 'sort', 'status', 'view'],
  );
  assert.deepEqual(
    [...new URLSearchParams(cards.split('?')[1]).entries()].find(
      ([name]) => name === 'view',
    ),
    ['view', 'cards'],
  );
  // The default ordering and the default view both leave their own parameter out.
  const plain = inventoryHref({
    query: '',
    sort: null,
    view: 'table',
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

// The switch is two icons — the grid and the table — instead of two words. Each link keeps its
// name in the package's visually hidden label, so it is still announced in both languages, and
// keeps aria-current as the state the stylesheet paints.
test('the view switch is icon-only, with a hidden name and the state kept', () => {
  const start = inventory.indexOf('<div className="seg" role="group"');
  assert.ok(start > 0, 'the view switch is rendered');
  const markup = inventory.slice(
    start,
    inventory.indexOf('<SearchIsland', start),
  );
  assert.match(markup, /aria-label=\{text\.viewLabel\}/);
  assert.equal(markup.match(/className="seg-icon"/g)?.length, 2);
  // The icons are decorative: the label beside each one is the name.
  assert.equal(markup.match(/aria-hidden="true"/g)?.length, 2);
  assert.match(markup, /<span className="sr">\{text\.viewCards\}<\/span>/);
  assert.match(markup, /<span className="sr">\{text\.viewTable\}<\/span>/);
  assert.equal(markup.match(/aria-current=\{requestedView/g)?.length, 2);
  // Nothing is left to read once the hidden labels are taken out: no visible words at all.
  assert.doesNotMatch(
    markup
      .replace(/<span className="sr">\{[^}]*\}<\/span>/g, '')
      .replace(/aria-label=\{[^}]*\}/g, ''),
    /\{text\./,
  );
  // Icon-only does not shrink the target: each link squares off to the package's control height.
  assert.match(surfaces, /\.seg a\.seg-btn \{[^}]*width: var\(--btn-h-sm\)/);
  for (const locale of ['vi', 'en'] as const)
    for (const key of ['viewCards', 'viewTable'] as const)
      assert.ok(
        messages[locale][key].trim().length,
        `${locale}.${key} is missing`,
      );
});
