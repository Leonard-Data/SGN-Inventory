// The inventory filter set as it travels in the page address, plus the one place its bounds are
// validated. The route validates the same strings the browser carries, so a filter is either
// applied exactly as the address states or refused as invalid input — never silently dropped.
// The province/ward pair names official administrative units; the ward is dependent on the
// province and, when both are set, the narrower ward is the unit the read applies. The contact
// value is a recorded contact identity, so it is validated with the same UUID shape.
const UUID_VALUE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const INVENTORY_STATUSES = [
  'draft',
  'available',
  'negotiating',
  'sold',
  'rented',
  'withdrawn',
] as const;
export const INVENTORY_LISTING_MODES = ['sale', 'rent', 'both'] as const;
export const INVENTORY_PROPERTY_TYPES = [
  'house',
  'land',
  'apartment',
  'villa',
  'serviced_apartment',
  'unclassified',
] as const;

export const INVENTORY_FILTER_KEYS = [
  'status',
  'mode',
  'type',
  'priceMin',
  'priceMax',
  'areaMin',
  'areaMax',
  'province',
  'ward',
  'contact',
] as const;
export type InventoryFilterKey = (typeof INVENTORY_FILTER_KEYS)[number];
export type InventoryFilters = Record<InventoryFilterKey, string | null>;

export const noInventoryFilters: InventoryFilters = {
  status: null,
  mode: null,
  type: null,
  priceMin: null,
  priceMax: null,
  areaMin: null,
  areaMax: null,
  province: null,
  ward: null,
  contact: null,
};

const WHOLE_VND = /^\d{1,18}$/;
const AREA_M2 = /^\d{1,10}(?:\.\d{1,2})?$/;

export function wholeVnd(value: string): boolean {
  return WHOLE_VND.test(value);
}

export function squareMetres(value: string): boolean {
  return AREA_M2.test(value) && areaHundredths(value) > 0n;
}

// The raw address values, before validation: the page hands the read what the address said.
export function inventoryFilters(params: URLSearchParams): InventoryFilters {
  const read = (key: InventoryFilterKey): string | null => {
    const value = params.get(key)?.trim() ?? '';
    return value === '' ? null : value;
  };
  return {
    status: read('status'),
    mode: read('mode'),
    type: read('type'),
    priceMin: read('priceMin'),
    priceMax: read('priceMax'),
    areaMin: read('areaMin'),
    areaMax: read('areaMax'),
    province: read('province'),
    ward: read('ward'),
    contact: read('contact'),
  };
}

export type InventoryFilterParse =
  { ok: true; filters: InventoryFilters } | { ok: false };

export function parseInventoryFilters(
  params: URLSearchParams,
): InventoryFilterParse {
  const filters = inventoryFilters(params);
  const {
    status,
    mode,
    type,
    priceMin,
    priceMax,
    areaMin,
    areaMax,
    province,
    ward,
    contact,
  } = filters;
  if (status !== null && !includes(INVENTORY_STATUSES, status)) return refuse();
  if (mode !== null && !includes(INVENTORY_LISTING_MODES, mode))
    return refuse();
  if (type !== null && !includes(INVENTORY_PROPERTY_TYPES, type))
    return refuse();
  // A unit value is an official catalog identity and the contact is a recorded identity, so a
  // malformed value is refused here; an out-of-catalog or wrong-level unit and an unknown or
  // unreadable contact are refused by the route's own checks.
  for (const value of [province, ward, contact])
    if (value !== null && !UUID_VALUE.test(value)) return refuse();
  // The ward narrows its parent province; a ward without that province is not a filter set this
  // panel can produce, so it is refused rather than applied as a different inventory.
  if (ward !== null && province === null) return refuse();
  for (const price of [priceMin, priceMax])
    if (price !== null && !wholeVnd(price)) return refuse();
  for (const area of [areaMin, areaMax])
    if (area !== null && !squareMetres(area)) return refuse();
  if (
    priceMin !== null &&
    priceMax !== null &&
    BigInt(priceMin) > BigInt(priceMax)
  )
    return refuse();
  if (
    areaMin !== null &&
    areaMax !== null &&
    areaHundredths(areaMin) > areaHundredths(areaMax)
  )
    return refuse();
  return { ok: true, filters };
}

// Only the filters the address actually sets become query parameters, so an unfiltered view
// stays the plain browse rather than a browse over empty bounds.
export function filterParams(
  filters: InventoryFilters,
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of INVENTORY_FILTER_KEYS) {
    const value = filters[key];
    if (value !== null && value !== '') params[key] = value;
  }
  return params;
}

export function activeFilterCount(filters: InventoryFilters): number {
  return Object.keys(filterParams(filters)).length;
}

// The catalog check the route runs after parsing: a province value must name a province-level
// unit and a ward value a commune-level one inside the stated province, so absent, out-of-catalog,
// swapped or mismatched units are refused instead of matching a different inventory.
export function catalogUnitsMatch(
  units: readonly {
    id: string;
    unit_level: string;
    parent_id: string | null;
  }[],
  filters: InventoryFilters,
): boolean {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const { province, ward } = filters;
  if (province !== null && byId.get(province)?.unit_level !== 'province')
    return false;
  if (ward === null) return true;
  const unit = byId.get(ward);
  if (unit?.unit_level !== 'commune') return false;
  return province === null || unit.parent_id === province;
}

export type InventoryFilterArgs = {
  p_status?: string;
  p_mode?: string;
  p_type?: string;
  p_price_min?: string;
  p_price_max?: string;
  p_area_min?: number;
  p_area_max?: number;
  p_area_id?: string;
  p_contact_id?: string;
};

// Half of each range is optional; an absent bound leaves the database default (no bound) in
// place instead of sending a zero that would mean a real limit.
export function filterRpcArgs(filters: InventoryFilters): InventoryFilterArgs {
  const args: InventoryFilterArgs = {};
  if (filters.status) args.p_status = filters.status;
  if (filters.mode) args.p_mode = filters.mode;
  if (filters.type) args.p_type = filters.type;
  if (filters.priceMin) args.p_price_min = filters.priceMin;
  if (filters.priceMax) args.p_price_max = filters.priceMax;
  if (filters.areaMin) args.p_area_min = Number(filters.areaMin);
  if (filters.areaMax) args.p_area_max = Number(filters.areaMax);
  // Both the browse and the chronological walk take one administrative unit, so the narrower
  // ward governs and the province is kept in the address only as its parent context.
  const areaId = filters.ward ?? filters.province;
  if (areaId) args.p_area_id = areaId;
  if (filters.contact) args.p_contact_id = filters.contact;
  return args;
}

function includes<T extends string>(
  options: readonly T[],
  value: string,
): value is T {
  return (options as readonly string[]).includes(value);
}

// One area value as hundredths of a square metre, so two recorded decimal areas compare exactly
// rather than through a JavaScript number.
export function areaHundredths(area: string): bigint {
  const [whole, fraction = ''] = area.split('.') as [string, string?];
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function refuse(): InventoryFilterParse {
  return { ok: false };
}
