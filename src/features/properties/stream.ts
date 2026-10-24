// The properties list's own part of the streamed read: the entry-date ordering its sort control
// offers. The window arithmetic and the geometry it is read with live in `@/features/stream`,
// which every streamed list shares.
//
// Both orderings - the ordinary most-recently-changed browse and the eligible oldest-first/
// newest-first entry chronology - are one read, so the count and the rows always describe one
// result set.
export * from '../stream/window.ts';

// The two inventory-entry orderings the Order control states, and the columns a table header can
// order by. A column ordering is the field and its direction in one address value, so a reload or
// a shared link reads the same order the header was left in.
export type InventoryEntryOrder = 'oldest' | 'newest';
export const INVENTORY_SORT_FIELDS = [
  'price',
  'area',
  'frontage',
  'depth',
  'status',
  'changed',
] as const;
export type InventorySortField = (typeof INVENTORY_SORT_FIELDS)[number];
export type SortDirection = 'asc' | 'desc';
export type InventoryColumnOrder = `${InventorySortField}-${SortDirection}`;
export type InventoryOrder = InventoryEntryOrder | InventoryColumnOrder;

// Every ordering this application knows, in one place: the address read, the Order control and
// the table header all ask this set whether a stated value is one of them.
const ORDERS: ReadonlySet<string> = new Set([
  'oldest',
  'newest',
  ...INVENTORY_SORT_FIELDS.flatMap((field) => [
    `${field}-asc`,
    `${field}-desc`,
  ]),
]);

export function isInventoryOrder(value: unknown): value is InventoryOrder {
  return typeof value === 'string' && ORDERS.has(value);
}

// Whether the stated order is the inventory-entry chronology, which is the eligible-status view
// rather than a reordering of the ordinary browse.
export function isEntryOrder(
  order: string | null,
): order is InventoryEntryOrder {
  return order === 'oldest' || order === 'newest';
}

// The column and direction a stated order names, or null for the entry chronology and for an
// address that states no order at all.
export function columnOrder(
  order: string | null,
): { field: InventorySortField; direction: SortDirection } | null {
  if (!isInventoryOrder(order) || isEntryOrder(order)) return null;
  const split = order.lastIndexOf('-');
  return {
    field: order.slice(0, split) as InventorySortField,
    direction: order.slice(split + 1) as SortDirection,
  };
}

// The order the list opens in, and the one a third click on a heading returns it to: the record's
// own modification time, most recently modified first, then the property identity. `stream_inventory`
// reads exactly this when `p_order` is absent, `orderCatalogue` sorts the loaded rows into it, and
// the address omits `sort` for it, so the read, the table and the URL state one default.
export const DEFAULT_ORDER: InventoryColumnOrder = 'changed-desc';

// One header click: ascending, then descending, then back to the default order the list opens on.
export function nextColumnOrder(
  order: string | null,
  field: InventorySortField,
): InventoryOrder | null {
  const stated = columnOrder(order);
  if (stated?.field !== field) return `${field}-asc`;
  return stated.direction === 'asc' ? `${field}-desc` : null;
}

// The direction toggle has a target only when an entry-date ordering is active: a column order
// states its own direction and the default order has no chronology to reverse.
export function reversedOrder(
  order: InventoryOrder | null,
): InventoryEntryOrder | null {
  if (!isEntryOrder(order)) return null;
  return order === 'oldest' ? 'newest' : 'oldest';
}
