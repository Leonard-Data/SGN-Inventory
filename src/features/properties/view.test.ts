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
    hide: null,
    filters,
  });
  assert.deepEqual(
    [...new URLSearchParams(table.split('?')[1]).entries()].sort(),
    [
      ['addressFormat', 'legacy'],
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
    hide: null,
    filters,
  });
  assert.deepEqual(
    [...new URLSearchParams(cards.split('?')[1]).keys()].sort(),
    [
      'addressFormat',
      'mode',
      'priceMin',
      'province',
      'query',
      'sort',
      'status',
      'view',
    ],
  );
  assert.deepEqual(
    [...new URLSearchParams(cards.split('?')[1]).entries()].find(
      ([name]) => name === 'view',
    ),
    ['view', 'cards'],
  );
  // The default ordering and the default view both leave their own parameter out; the address
  // format is always stated, because it is always one of the two formats the list reads through.
  const plain = inventoryHref({
    query: '',
    sort: null,
    view: 'table',
    hide: null,
    filters: noInventoryFilters,
  });
  assert.equal(plain, '/properties?query=&addressFormat=legacy');
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

// The rows are one surface: the list is framed by the package's own border and radius instead of
// meeting the page squarely, and the first and last rows are rounded with the frame so no square
// corner of a row paints over it.
test('the table sits inside one rounded, bordered surface', () => {
  const frame = surfaces.slice(surfaces.indexOf('.inventory-stream {'));
  const rule = frame.slice(0, frame.indexOf('}'));
  assert.match(rule, /border: 1px solid var\(--border\)/);
  assert.match(rule, /border-radius: var\(--radius-lg\)/);
  assert.match(rule, /background: var\(--surface\)/);
  // The surface, not the whole page, contains a table wider than its available space.
  assert.match(rule, /width: 100%/);
  // The corners of the first and last rows follow the frame.
  for (const corner of [
    'thead th:first-child',
    'thead th:last-child',
    'tr:last-child > :first-child',
    'tr:last-child > :last-child',
  ]) {
    const start = surfaces.indexOf(`.inventory-table ${corner} {`);
    assert.ok(start > 0, `${corner} is rounded`);
    assert.match(
      surfaces.slice(start, surfaces.indexOf('}', start)),
      /border-(top|bottom)-(left|right)-radius: var\(--radius-lg\)/,
    );
  }
  // Separate borders keep the sticky header's own border attached to it while it scrolls.
  const table = surfaces.slice(surfaces.indexOf('.inventory-table {'));
  assert.match(table.slice(0, table.indexOf('}')), /border-collapse: separate/);
});

// One bounded table scrollport keeps sticky headings working while containing both axes.
test('the table surface owns its scrollport and the virtual band measures it', () => {
  const start = surfaces.indexOf('.inventory-stream {');
  assert.ok(start > 0, 'the base stream surface is defined');
  const frame = surfaces.slice(start, surfaces.indexOf('}', start));
  assert.match(frame, /overflow: auto/);
  assert.match(frame, /max-height: calc\(100dvh/);
  assert.match(inventory, /node\.scrollTop/);
  assert.match(inventory, /node\.clientHeight/);
  const table = surfaces.slice(surfaces.indexOf('.inventory-table {'));
  assert.doesNotMatch(table.slice(0, table.indexOf('}')), /overflow|height:/);
});
