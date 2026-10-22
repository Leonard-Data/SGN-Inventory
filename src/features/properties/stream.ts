// The properties list's own part of the streamed read: the entry-date ordering its sort control
// offers. The window arithmetic and the geometry it is read with live in `@/features/stream`,
// which every streamed list shares.
//
// Both orderings - the ordinary most-recently-changed browse and the eligible oldest-first/
// newest-first entry chronology - are one read, so the count and the rows always describe one
// result set.
export * from '../stream/window.ts';

export type InventoryOrder = 'oldest' | 'newest';

export function isInventoryOrder(value: unknown): value is InventoryOrder {
  return value === 'oldest' || value === 'newest';
}

// The direction toggle has a target only when an entry-date ordering is active: the default
// order has no chronology to reverse.
export function reversedOrder(
  order: InventoryOrder | null,
): InventoryOrder | null {
  if (order === null) return null;
  return order === 'oldest' ? 'newest' : 'oldest';
}
