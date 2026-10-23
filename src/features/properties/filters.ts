// The inventory filter set as it travels in the page address, plus the one place its bounds are
// validated. The route validates the same strings the browser carries, so a filter is either
// applied exactly as the address states or refused as invalid input — never silently dropped.
// The access type is the way a property is reached, one of the five states every record records, so
// it is filtered by that recorded value alone and an absent one applies no access condition.
// The business records addresses in one province, so the district and ward levels narrow inside
// that stated province (`FIXED_PROVINCE`) rather than a chosen one: the district only exists in the
// closed pre-2025 three-tier generation, so it is a legacy-address filter and no part of a
// current-address search. The read applies every level that is
// stated to one address of the searched format. The ward level carries one commune or a set of
// them, so a search spans several communes at once: the address states them comma-separated, one
// value reads exactly as the single commune the filter always carried, and the read matches a
// property when any one of them is the address's own commune. The contact
// value is a recorded contact identity, so it is validated with the same UUID shape. The address
// format is the format of the address a search is matched through: the page states the legacy address
// unless the address clears the filter, and clearing it states no format condition so a property
// recorded in either format is reachable.
import { FIXED_PROVINCE } from '../property-maintenance/units.ts';

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
// The five recorded access states, in the record's own order. A property always records one, so the
// state that means "not known" is a value to filter by rather than an unstated one.
export const INVENTORY_ACCESS_TYPES = [
  'unknown',
  'street_front',
  'car_alley',
  'motorbike_alley',
  'three_wheeler_alley',
] as const;
// The two formats a search is matched through. An `alternate` address is a recorded other address
// rather than one of the two formats a property is searched by, so it is no filter value.
export const INVENTORY_ADDRESS_FORMATS = ['legacy', 'current'] as const;
// The cleared state beside the two formats: no format condition at all, which the read expresses by
// the absent parameter rather than by a format it would be asked to match. The address carries it so
// a reload keeps the filter cleared instead of reopening the default; it is not a format a property
// records, and it is no value the panel offers beside the two.
export const INVENTORY_ADDRESS_FORMAT_ANY = 'any';
export const INVENTORY_ADDRESS_FORMAT_VALUES = [
  ...INVENTORY_ADDRESS_FORMATS,
  INVENTORY_ADDRESS_FORMAT_ANY,
] as const;
export const DEFAULT_ADDRESS_FORMAT = 'legacy';

export const INVENTORY_FILTER_KEYS = [
  'status',
  'mode',
  'type',
  'accessType',
  'addressFormat',
  'priceMin',
  'priceMax',
  'areaMin',
  'areaMax',
  'frontageMin',
  'frontageMax',
  'depthMin',
  'depthMax',
  // Read so a shared address that still states one is honoured or refused, but never applied: the
  // app's province is fixed, so no search or read carries it.
  'province',
  'district',
  'ward',
  'contact',
  'createdBy',
] as const;
export type InventoryFilterKey = (typeof INVENTORY_FILTER_KEYS)[number];
export type InventoryFilters = Record<InventoryFilterKey, string | null>;

// The one creator selection the list offers. It names no employee: the filter compares each
// record's creator with the employee reading the list, so the address carries a fixed token rather
// than an identity that a shared link would filter somebody else's inventory by.
export const INVENTORY_CREATOR_MINE = 'mine';

export const noInventoryFilters: InventoryFilters = {
  status: null,
  mode: null,
  type: null,
  accessType: null,
  addressFormat: DEFAULT_ADDRESS_FORMAT,
  priceMin: null,
  priceMax: null,
  areaMin: null,
  areaMax: null,
  frontageMin: null,
  frontageMax: null,
  depthMin: null,
  depthMax: null,
  province: null,
  district: null,
  ward: null,
  contact: null,
  createdBy: null,
};

const WHOLE_VND = /^\d{1,18}$/;
const AREA_M2 = /^\d{1,10}(?:\.\d{1,2})?$/;

export function wholeVnd(value: string): boolean {
  return WHOLE_VND.test(value);
}

// The communes a stated ward carries: one value is the single commune an older address states, and
// several are separated by a comma in the order they were chosen. An empty statement is no set at
// all, which is the same as no ward condition.
export function communeIds(value: string | null): string[] {
  return value === null || value === '' ? [] : value.split(',');
}

// The one stated value a set of communes travels as, or the absent condition an empty set is.
export function communeValue(ids: readonly string[]): string | null {
  return ids.length ? ids.join(',') : null;
}

// The filter set with one commune removed from its set: the others stay, so removing a commune
// narrows the search, and removing the last one clears the criterion.
export function withoutCommune(
  filters: InventoryFilters,
  id: string,
): InventoryFilters {
  return {
    ...filters,
    ward: communeValue(
      communeIds(filters.ward).filter((commune) => commune !== id),
    ),
  };
}

// The catalog reads that name an applied filter: one read per level, a commune set travelling as
// the one set the address states.
export function appliedUnitLookups(
  district: string | null,
  ward: string | null,
): { level: 'district' | 'commune'; include: string }[] {
  const communes = communeIds(ward);
  return [
    ...(district ? [{ level: 'district' as const, include: district }] : []),
    ...(communes.length
      ? [{ level: 'commune' as const, include: communes.join(',') }]
      : []),
  ];
}

// The one measured-value rule: a positive number with at most two decimals and inside the numeric
// ceiling. An area and a frontage or depth bound are both stated by it, as the database read states
// them.
export function squareMetres(value: string): boolean {
  return AREA_M2.test(value) && areaHundredths(value) > 0n;
}

// The raw address values, before validation: the page hands the read what the address said. The
// value an address that states no format carries is the boundary's own: the page's addresses state
// the legacy search the panel opens on, while a read that takes its criteria as optional parameters
// states the no-format condition for an absent one.
export function inventoryFilters(
  params: URLSearchParams,
  absentAddressFormat: string = DEFAULT_ADDRESS_FORMAT,
): InventoryFilters {
  const read = (key: InventoryFilterKey): string | null => {
    const value = params.get(key)?.trim() ?? '';
    return value === '' ? null : value;
  };
  return {
    status: read('status'),
    mode: read('mode'),
    type: read('type'),
    accessType: read('accessType'),
    addressFormat: read('addressFormat') ?? absentAddressFormat,
    priceMin: read('priceMin'),
    priceMax: read('priceMax'),
    areaMin: read('areaMin'),
    areaMax: read('areaMax'),
    frontageMin: read('frontageMin'),
    frontageMax: read('frontageMax'),
    depthMin: read('depthMin'),
    depthMax: read('depthMax'),
    province: read('province'),
    district: read('district'),
    ward: read('ward'),
    contact: read('contact'),
    createdBy: read('createdBy'),
  };
}

export type InventoryFilterParse =
  { ok: true; filters: InventoryFilters } | { ok: false };

export function parseInventoryFilters(
  params: URLSearchParams,
  absentAddressFormat: string = DEFAULT_ADDRESS_FORMAT,
): InventoryFilterParse {
  const filters = inventoryFilters(params, absentAddressFormat);
  const {
    status,
    mode,
    type,
    accessType,
    addressFormat,
    priceMin,
    priceMax,
    areaMin,
    areaMax,
    frontageMin,
    frontageMax,
    depthMin,
    depthMax,
    province,
    district,
    ward,
    contact,
    createdBy,
  } = filters;
  if (status !== null && !includes(INVENTORY_STATUSES, status)) return refuse();
  if (mode !== null && !includes(INVENTORY_LISTING_MODES, mode))
    return refuse();
  if (type !== null && !includes(INVENTORY_PROPERTY_TYPES, type))
    return refuse();
  if (accessType !== null && !includes(INVENTORY_ACCESS_TYPES, accessType))
    return refuse();
  if (!includes(INVENTORY_ADDRESS_FORMAT_VALUES, addressFormat ?? ''))
    return refuse();
  if (createdBy !== null && createdBy !== INVENTORY_CREATOR_MINE)
    return refuse();
  // A unit value is an official catalog identity and the contact is a recorded identity, so a
  // malformed value is refused here; an out-of-catalog or wrong-level unit and an unknown or
  // unreadable contact are refused by the route's own checks.
  for (const value of [province, district, contact])
    if (value !== null && !UUID_VALUE.test(value)) return refuse();
  // The ward is one identity or a set of them, so every entry is an identity of its own: an empty
  // entry, a malformed one or a commune stated twice is refused here rather than read as the set
  // minus what did not parse.
  const communes = communeIds(ward);
  if (communes.some((id) => !UUID_VALUE.test(id))) return refuse();
  if (new Set(communes).size !== communes.length) return refuse();
  // One province is recorded, so a link that still states it keeps working while a link naming any
  // other province is refused rather than applied as a filter the app cannot mean. Either way the
  // stated province is dropped: it is not a condition this app offers, and the levels beneath it
  // are matched inside the stated province alone.
  if (province !== null && province !== FIXED_PROVINCE.id) return refuse();
  // The two-tier generation has no district level, so a district on a current-address search names
  // no unit that address can record and is refused rather than read as a filter that matches
  // nothing.
  if (district !== null && searchedAddressFormat(filters) === 'current')
    return refuse();
  for (const price of [priceMin, priceMax])
    if (price !== null && !wholeVnd(price)) return refuse();
  // An area and a frontage or depth bound are the same kind of measured value, so one rule
  // validates them all.
  for (const measure of [
    areaMin,
    areaMax,
    frontageMin,
    frontageMax,
    depthMin,
    depthMax,
  ])
    if (measure !== null && !squareMetres(measure)) return refuse();
  if (
    priceMin !== null &&
    priceMax !== null &&
    BigInt(priceMin) > BigInt(priceMax)
  )
    return refuse();
  // Each range is its own: a stated minimum above its maximum is refused rather than answered as
  // an inventory that matches nothing.
  const reversed = (low: string | null, high: string | null): boolean =>
    low !== null && high !== null && areaHundredths(low) > areaHundredths(high);
  if (
    reversed(areaMin, areaMax) ||
    reversed(frontageMin, frontageMax) ||
    reversed(depthMin, depthMax)
  )
    return refuse();
  return { ok: true, filters: { ...filters, province: null } };
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

// The catalog check the route runs after parsing: a district value must name a district-level unit
// and every stated ward a commune-level one, each inside the one province the business records, so
// absent, out-of-catalog, swapped or mismatched units are refused instead of matching a different
// inventory. A set of wards is refused whole by one bad entry rather than narrowed to the entries
// the catalog does carry. The province is one official unit with a row per catalog generation, so it
// is matched by its official code rather than by the version row id a recorded address happens to
// reference: a legacy ward hangs under its district, whose own parent is that province's pre-2025
// row, while a current ward hangs directly off its current row. A ward whose district is missing
// from the list, or which hangs off another district than the one stated, stays mismatched.
export function catalogUnitsMatch(
  units: readonly {
    id: string;
    unit_level: string;
    parent_id: string | null;
    official_code?: string;
  }[],
  filters: InventoryFilters,
  provinceCode: string,
): boolean {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const isProvince = (id: string | null | undefined): boolean => {
    const unit = id ? byId.get(id) : undefined;
    return (
      unit?.unit_level === 'province' && unit.official_code === provinceCode
    );
  };
  const { district, ward } = filters;
  if (district !== null) {
    const unit = byId.get(district);
    if (unit?.unit_level !== 'district' || !isProvince(unit.parent_id))
      return false;
  }
  // Every stated commune stands on its own: one that is absent, of another level or outside the
  // stated district refuses the whole set rather than being dropped from it.
  for (const id of communeIds(ward)) {
    const unit = byId.get(id);
    if (unit?.unit_level !== 'commune') return false;
    // The stated district is the commune's own parent, so a commune outside it names no address
    // this set could match.
    if (district !== null && unit.parent_id !== district) return false;
    if (isProvince(unit.parent_id)) continue;
    const parent =
      unit.parent_id === null ? undefined : byId.get(unit.parent_id);
    if (parent?.unit_level !== 'district' || !isProvince(parent.parent_id))
      return false;
  }
  return true;
}

export type InventoryFilterArgs = {
  p_status?: string;
  p_mode?: string;
  p_type?: string;
  p_access_type?: string;
  p_price_min?: string;
  p_price_max?: string;
  p_area_min?: number;
  p_area_max?: number;
  p_frontage_min?: number;
  p_frontage_max?: number;
  p_depth_min?: number;
  p_depth_max?: number;
  p_province_id?: string;
  p_district_id?: string;
  p_commune_ids?: string[];
  p_contact_id?: string;
  p_address_format?: string;
};

// The format a filter set searches through, held in one place so the local match and the database
// read can never be pointed at different formats by a set that states none.
export function searchedAddressFormat(filters: InventoryFilters): string {
  return filters.addressFormat ?? DEFAULT_ADDRESS_FORMAT;
}

// The address levels the panel offers for the format it is set to: a legacy address names a district
// and a ward and a current one a ward alone, each inside the one stated province. A cleared format
// states no condition, so it keeps the legacy shape the panel opens on.
export function offeredAddressLevels(
  format: string,
): readonly ('district' | 'ward')[] {
  return format === 'current' ? ['ward'] : ['district', 'ward'];
}

// Half of each range is optional; an absent bound leaves the database default (no bound) in
// place instead of sending a zero that would mean a real limit.
export function filterRpcArgs(filters: InventoryFilters): InventoryFilterArgs {
  const args: InventoryFilterArgs = {};
  if (filters.status) args.p_status = filters.status;
  if (filters.mode) args.p_mode = filters.mode;
  if (filters.type) args.p_type = filters.type;
  if (filters.accessType) args.p_access_type = filters.accessType;
  if (filters.priceMin) args.p_price_min = filters.priceMin;
  if (filters.priceMax) args.p_price_max = filters.priceMax;
  if (filters.areaMin) args.p_area_min = Number(filters.areaMin);
  if (filters.areaMax) args.p_area_max = Number(filters.areaMax);
  if (filters.frontageMin) args.p_frontage_min = Number(filters.frontageMin);
  if (filters.frontageMax) args.p_frontage_max = Number(filters.frontageMax);
  if (filters.depthMin) args.p_depth_min = Number(filters.depthMin);
  if (filters.depthMax) args.p_depth_max = Number(filters.depthMax);
  // The no-format choice is the read's own unconditional form: the parameter stays absent so no
  // format condition is applied.
  const format = searchedAddressFormat(filters);
  if (format !== INVENTORY_ADDRESS_FORMAT_ANY) args.p_address_format = format;
  // Each stated level travels on its own, because the read composes them on one address of the
  // searched format: a district and a ward narrow inside the one stated province, rather than one
  // narrower unit replacing the levels above it. No province travels: the app records one.
  if (filters.district) args.p_district_id = filters.district;
  // The communes travel as the set they are, so one read answers the union of what each commune
  // would answer alone rather than the last one replacing the one before it.
  const communes = communeIds(filters.ward);
  if (communes.length) args.p_commune_ids = communes;
  if (filters.contact) args.p_contact_id = filters.contact;
  // The creator selection has no argument here on purpose: the whole-inventory read carries no
  // creator criterion, so that selection is answered from the loaded catalogue alone
  // (`catalogue-results.ts`) and never reaches this read.
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
