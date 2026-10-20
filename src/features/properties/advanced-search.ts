// The advanced search's own cache (issue #194). The criteria the loaded catalogue cannot answer
// are an explicit whole-inventory read, so its pages are held under keys of their own - the
// caller's authorized scope, the submitted criteria, the ordering and the page - and are retained
// for a bounded time instead of for the browser session the catalogue itself lives for.
import {
  filterParams,
  inventoryFilters,
  type InventoryFilters,
} from './filters.ts';

// Bounded retention, deliberately separate from the catalogue's own infinity: an advanced result
// states what the database held when it was read, while the catalogue is the browsing snapshot a
// person keeps until they refresh it. A page that nothing has read for the retention window is
// dropped and read again from the database.
export const ADVANCED_SEARCH_STALE_MS = 30_000;
export const ADVANCED_SEARCH_GC_MS = 5 * 60_000;

// The criteria one advanced search was submitted with. It travels with the address, so a submitted
// search survives a reload; editing a control is not an advanced search because nothing is
// submitted until the panel is run.
export type AdvancedCriteria = {
  query: string;
  filters: InventoryFilters;
  sort: string | null;
};

// What every advanced page is read with: never refetched on its own, and dropped once nothing has
// read it for the retention window.
export const ADVANCED_SEARCH_QUERY_OPTIONS = {
  staleTime: ADVANCED_SEARCH_STALE_MS,
  gcTime: ADVANCED_SEARCH_GC_MS,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchInterval: false,
} as const;

// The criteria a submitted search's address states. The address is built from exactly these, so
// reading them back is how the reader keys a search by what it reads rather than by an object a
// render rebuilt.
export function searchCriteria(source: string): AdvancedCriteria {
  const params = new URLSearchParams(source.slice(source.indexOf('?') + 1));
  return {
    query: params.get('query') ?? '',
    filters: inventoryFilters(params),
    sort: params.get('sort'),
  };
}

// One page of one advanced search: the authorized scope, the submitted criteria, the ordering and
// the page. Two searches that differ in any of these are different entries, so a page is never
// answered from a different search's rows, and the catalogue's own key is never reused for them.
export function advancedSearchKey({
  scope,
  criteria,
  page,
}: {
  scope: string;
  criteria: AdvancedCriteria;
  page: number;
}): readonly unknown[] {
  // The filter pairs are read in the filter set's own key order, so the same criteria always
  // produce the same key whatever order they were set in.
  return [
    'property-search',
    scope,
    criteria.query.trim(),
    ...Object.entries(filterParams(criteria.filters)).flat(),
    criteria.sort ?? '',
    page,
  ];
}
