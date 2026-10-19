// Which of the two result views the page renders, and the address that carries it. The view is a
// presentation choice over one stream: it travels in the page address beside the search, the
// ordering and the filters, so switching views keeps the result set the person narrowed down and
// applying a filter keeps the view they chose. A view never changes the read.
import { filterParams, type InventoryFilters } from './filters.ts';

export type InventoryView = 'cards' | 'table';

// Phone width: a ten-column table cannot be operated there, so it is not offered at all — the
// same 640px the shell already treats as one column. The page watches this boundary through the
// equivalent browser query rather than by asking for a width, so the switch follows the viewport
// as it changes instead of only at the next render.
export const PHONE_MAX_WIDTH_PX = 640;

// The card grid at every width above the phone breakpoint, matching the auto-fill grid the
// package's card list draws: one track per whole column of at least 300px plus the 20px gap.
// The browser fits the same number of tracks, so the stream lays its cards out on the same
// columns the plain list would. At phone width — and in the container narrower than one column —
// the single column is the answer, exactly as the stylesheet settles it.
export const CARD_MIN_WIDTH_PX = 300;
export const CARD_GAP_PX = 20;

export function cardColumns(
  width: number,
  min = CARD_MIN_WIDTH_PX,
  gap = CARD_GAP_PX,
): number {
  if (!Number.isFinite(width) || width <= PHONE_MAX_WIDTH_PX) return 1;
  return Math.max(1, Math.floor((width + gap) / (min + gap)));
}

// How many cards one mounted chunk holds: whole rows of the measured column count, so a chunk
// boundary always falls between two grid rows and never leaves a half-filled row behind.
export const CARD_CHUNK_ROWS = 3;

export function cardChunkRows(columns: number, rows = CARD_CHUNK_ROWS): number {
  return Math.max(1, Math.floor(columns)) * Math.max(1, Math.floor(rows));
}

export type InventoryViewParse =
  { ok: true; view: InventoryView } | { ok: false };

// The address states the view plainly: `cards` or `table`. An absent or empty value is the
// default cards; anything else is refused rather than quietly served as a different view than
// the address names.
export function parseInventoryView(value: string | null): InventoryViewParse {
  if (value === null || value.trim() === '' || value === 'cards')
    return { ok: true, view: 'cards' };
  if (value === 'table') return { ok: true, view: 'table' };
  return { ok: false };
}

// The address of one result set: the search, the ordering, the filters and the view, in one
// place, so a link that changes one of them keeps the rest. The default view is left out so the
// ordinary address stays the short one.
export function inventoryHref({
  query,
  sort,
  view,
  filters,
}: {
  query: string;
  sort: string | null;
  view: InventoryView;
  filters: InventoryFilters;
}): string {
  const params = new URLSearchParams({ query });
  if (sort) params.set('sort', sort);
  if (view === 'table') params.set('view', 'table');
  for (const [name, value] of Object.entries(filterParams(filters)))
    params.set(name, value);
  return '/properties?' + params;
}
