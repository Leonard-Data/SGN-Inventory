// What the loaded catalogue answers in the browser and what only the database can answer
// (issue #194). The ordinary browse, the supported filters, the ordering the summaries carry and
// the result paging are computed here from rows the browser already holds; a criterion the
// summaries do not carry is never approximated locally - it is an explicit whole-inventory search
// the person chooses to run. Everything below is arithmetic and classification over values the
// browser holds, so the split and the local result set are testable without a browser or a read.
import {
  matchCatalogue,
  type CatalogueIndexEntry,
  type CatalogueMatch,
} from './address-index.ts';
import {
  areaHundredths,
  filterParams,
  parseInventoryFilters,
  type InventoryFilterKey,
  type InventoryFilters,
} from './filters.ts';
import type { PropertySummary } from './types.ts';

// The filters the catalogue's own summary fields answer:
//   status            -> the recorded status
//   mode              -> the recorded listing mode
//   type              -> the recorded property type
//   priceMin/Max      -> the recorded sale price or monthly rent
//   areaMin/Max       -> the recorded land or floor area
export const LOCAL_FILTER_KEYS = [
  'status',
  'mode',
  'type',
  'priceMin',
  'priceMax',
  'areaMin',
  'areaMax',
] as const;

// The filters the summaries carry no field for: an official administrative-unit identity and a
// recorded contact identity are names in the database's own catalog, not text the summary holds.
export const ADVANCED_FILTER_KEYS = ['province', 'ward', 'contact'] as const;

// The filters of a stated set the loaded catalogue cannot answer. Empty means every stated filter
// is one the summaries can apply locally.
export function advancedFilterKeys(
  filters: InventoryFilters,
): InventoryFilterKey[] {
  return ADVANCED_FILTER_KEYS.filter(
    (key) => filters[key] !== null && filters[key] !== '',
  );
}

// A stated ordering is an advanced criterion: in the database read a chronological ordering is
// also the narrower eligible-status view rather than a reordering of the rows the catalogue
// holds, and an ordering this application does not know is refused by that read rather than
// served as a different order.
export function advancedOrder(sort: string | null): boolean {
  return sort !== null && sort.trim() !== '';
}

// The filter-panel draft while it is being edited. The panel asks this which of the criteria it
// is holding the loaded catalogue cannot answer, so its action can name the read it will perform
// instead of promising a filter. Nothing here is a submission: the draft is only classified when
// the panel is run, which is what keeps an edit from running a query.
export type PanelDraft = {
  province: string;
  ward: string;
  contact: string;
  order: string;
};

export function draftNeedsAdvancedSearch(draft: PanelDraft): boolean {
  return Boolean(draft.province || draft.ward || draft.contact || draft.order);
}

export type ResultMode = 'catalogue' | 'advanced';

// Whether the stated filters are a set the address could have produced. The one place its bounds
// are validated is `filters.ts`, and the database read runs the same check, so a mangled status, a
// price that is not whole VND, a zero area or a reversed range is never applied locally as a
// different filter - it is handed to that read, which refuses it exactly as it always has.
function statedFiltersAreValid(filters: InventoryFilters): boolean {
  return parseInventoryFilters(new URLSearchParams(filterParams(filters))).ok;
}

// Which result set the stated criteria describe. A stated advanced filter or ordering is the
// whole-inventory search the person asked for; the address box being edited narrows the loaded
// catalogue in the browser; otherwise a submitted query is the whole-inventory search and a plain
// address is the loaded catalogue.
export function resultMode({
  query,
  filters,
  sort,
  typing,
}: {
  query: string;
  filters: InventoryFilters;
  sort: string | null;
  typing: boolean;
}): ResultMode {
  if (!statedFiltersAreValid(filters)) return 'advanced';
  if (advancedFilterKeys(filters).length > 0) return 'advanced';
  if (advancedOrder(sort)) return 'advanced';
  if (typing) return 'catalogue';
  return query.trim() === '' ? 'catalogue' : 'advanced';
}

export type InventoryRead =
  { kind: 'catalogue' } | { kind: 'advanced'; endpoint: string };
// The one read a result set performs. A catalogue result names no endpoint at all: the rows are
// already in the browser, so filtering, ordering and paging them costs no request.
export function inventoryRead({
  mode,
  endpoint,
}: {
  mode: ResultMode;
  endpoint: string;
}): InventoryRead {
  return mode === 'advanced'
    ? { kind: 'advanced', endpoint }
    : { kind: 'catalogue' };
}

function wholeVnd(value: string): bigint | null {
  return /^\d{1,18}$/.test(value) ? BigInt(value) : null;
}

function hundredths(value: string | null): bigint | null {
  if (value === null) return null;
  try {
    return areaHundredths(value);
  } catch {
    return null;
  }
}

function within(
  value: bigint | null,
  low: bigint | null,
  high: bigint | null,
): boolean {
  return (
    value !== null &&
    (low === null || value >= low) &&
    (high === null || value <= high)
  );
}

// The price a stated bound applies to, exactly as the database read decides it: a rent listing -
// or a read explicitly filtered to rent - is bound by its monthly rent, every other listing by
// its sale price.
function boundedPrice(
  record: PropertySummary,
  mode: string | null,
): string | null {
  return (mode ?? record.listingMode) === 'rent'
    ? record.monthlyRentVnd
    : record.salePriceVnd;
}

// One property against the filters the catalogue answers, mirroring the database read's own
// predicate: a `both` listing matches either stated mode, a range with neither bound stated is
// skipped rather than applied as a zero, and a null recorded value never satisfies a stated bound.
export function matchesLocalFilters(
  record: PropertySummary,
  filters: InventoryFilters,
): boolean {
  if (filters.status !== null && record.status !== filters.status) return false;
  if (
    filters.mode !== null &&
    record.listingMode !== filters.mode &&
    record.listingMode !== 'both'
  )
    return false;
  if (filters.type !== null && record.propertyType !== filters.type)
    return false;
  if (filters.priceMin !== null || filters.priceMax !== null) {
    const price = boundedPrice(record, filters.mode);
    if (
      !within(
        price === null ? null : wholeVnd(price),
        filters.priceMin === null ? null : wholeVnd(filters.priceMin),
        filters.priceMax === null ? null : wholeVnd(filters.priceMax),
      )
    )
      return false;
  }
  if (filters.areaMin !== null || filters.areaMax !== null) {
    const low = filters.areaMin === null ? null : hundredths(filters.areaMin);
    const high = filters.areaMax === null ? null : hundredths(filters.areaMax);
    const land = hundredths(record.landAreaM2);
    const floor = hundredths(record.floorAreaM2);
    // Either recorded area satisfies the range, as it does in the database read.
    if (!within(land, low, high) && !within(floor, low, high)) return false;
  }
  return true;
}

// Newest-created first, then the property identity descending: the total order the database's
// ordinary browse read uses, and the one ordering the catalogue's own fields can produce.
export function orderCatalogue(
  matches: readonly CatalogueMatch[],
): CatalogueMatch[] {
  return [...matches].sort((left, right) => {
    const created = compareCreatedDesc(left.record, right.record);
    return created !== 0
      ? created
      : compareDesc(left.record.id, right.record.id);
  });
}

function compareCreatedDesc(
  left: PropertySummary,
  right: PropertySummary,
): number {
  // The recorded creation time is not null in the database; a summary that states none sorts
  // where PostgreSQL's descending order would put it.
  return compareDesc(left.createdAt ?? '', right.createdAt ?? '');
}

function compareDesc(left: string, right: string): number {
  return left < right ? 1 : left > right ? -1 : 0;
}

// The properties the loaded catalogue answers with: the recorded addresses matched against what
// the person typed, narrowed by the filters the summaries carry. A typed query keeps the address
// ranking; an unfiltered browse reads in the catalogue's own created ordering, so the ordinary
// list reads the way the inventory browse does. An empty loaded catalogue is an empty result, and
// the list states its coverage separately rather than presenting that as an empty inventory.
export function catalogueMatches(
  index: readonly CatalogueIndexEntry[],
  { query, filters }: { query: string; filters: InventoryFilters },
): CatalogueMatch[] {
  const matched = matchCatalogue(index, query).filter((match) =>
    matchesLocalFilters(match.record, filters),
  );
  return query.trim() === '' ? orderCatalogue(matched) : matched;
}
