// The inventory pager carries a page number in the page address and turns it into the one
// filtered read that returns the matching total beside its rows. Both orderings - the ordinary
// browse and the eligible oldest-first/newest-first chronology - are that read, so the count,
// the rows and the page links always describe the same result set.
export type InventoryOrder = 'oldest' | 'newest';

export const INVENTORY_PAGE_SIZES = [12, 24, 48] as const;
export type InventoryPageSize = (typeof INVENTORY_PAGE_SIZES)[number];
export const INVENTORY_PAGE_SIZE = 24;

export function isInventoryPageSize(
  value: unknown,
): value is InventoryPageSize {
  return INVENTORY_PAGE_SIZES.some((size) => String(size) === String(value));
}
// The numbered links are a bounded window around the current page, so a large result set never
// renders hundreds of links; first, last and the jump control reach the rest.
export const INVENTORY_PAGE_WINDOW = 7;

const POSITIVE_INTEGER = /^[1-9]\d{0,8}$/;

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

export type InventoryPaging = { page: number; pageSize: InventoryPageSize };
export type InventoryPagingParse =
  { ok: true; paging: InventoryPaging } | { ok: false };

// An absent value is the first page. A value the address states must be a plain positive integer,
// so a mangled or unsupported page is refused rather than read as a different page than the
// address asked for.
export function parseInventoryPaging(
  params: URLSearchParams,
): InventoryPagingParse {
  const page = positive(params.get('page'));
  const rawPageSize = params.get('pageSize');
  if (
    page === undefined ||
    (rawPageSize !== null && !isInventoryPageSize(rawPageSize))
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    paging: {
      page: page ?? 1,
      pageSize: rawPageSize
        ? (Number(rawPageSize) as InventoryPageSize)
        : INVENTORY_PAGE_SIZE,
    },
  };
}

// A result set always has a page one, even when it has no rows, so the pager states where the
// caller is instead of showing an empty range.
export function inventoryPageCount(
  total: number,
  pageSize = INVENTORY_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

// The numbered pages the pager offers: a window of at most INVENTORY_PAGE_WINDOW pages that
// stays inside the result set and keeps the current page centred where the bounds allow.
export function pageNumbers(page: number, pages: number): number[] {
  const span = Math.min(pages, INVENTORY_PAGE_WINDOW);
  const start = Math.min(
    Math.max(page - Math.floor(span / 2), 1),
    pages - span + 1,
  );
  return Array.from({ length: span }, (_, index) => start + index);
}

function positive(value: string | null): number | null | undefined {
  if (value === null) return null;
  return POSITIVE_INTEGER.test(value) ? Number(value) : undefined;
}
