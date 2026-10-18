import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import type { AddressSummary, PropertyPage } from './types';
import {
  catalogUnitsMatch,
  filterRpcArgs,
  INVENTORY_FILTER_KEYS,
  parseInventoryFilters,
  type InventoryFilters,
} from './filters';
import {
  INVENTORY_PAGE_SIZE,
  isInventoryOrder,
  parseInventoryPaging,
  type InventoryOrder,
} from './paging';

export async function browseProperties(
  context: RouteContext,
  params: URLSearchParams,
): Promise<PropertyPage> {
  const query = params.get('query') ?? '';
  const sort = params.get('sort');
  if ([...query].length > 120) throw new ApiError(400, 'query-too-long');
  if (sort !== null && !isInventoryOrder(sort))
    throw new ApiError(400, 'invalid-input');
  // A filter the address states must be applied or refused; it is never dropped into a
  // different inventory than the one the address describes.
  const filters = parseInventoryFilters(params);
  if (!filters.ok) throw new ApiError(400, 'invalid-input');
  // The page number is read the same way: a mangled, zero or unsupported value is refused rather
  // than quietly served as a different page than the address states.
  const paging = parseInventoryPaging(params);
  if (!paging.ok) throw new ApiError(400, 'invalid-input');
  const allowed = [
    'query',
    'page',
    ...(sort === null ? [] : ['sort']),
    ...INVENTORY_FILTER_KEYS,
  ];
  if ([...params.keys()].some((key) => !allowed.includes(key)))
    throw new ApiError(400, 'invalid-input');
  // The area filter names official units from the same catalog the address form uses; a value
  // absent from the catalog, or naming the wrong level, is refused instead of matching a
  // different inventory.
  await assertAreaUnits(context, filters.filters);
  // The contact parameter names a recorded Contact the caller may read; an unknown or unreadable
  // identifier is refused rather than applied as a contact with no linked property.
  await assertContact(context, filters.filters);
  const order: InventoryOrder | null = sort;
  // One filtered read returns the matching total beside this page of rows. The ordering is the
  // argument, so the ordinary browse and the eligible chronology share one predicate: a count
  // that could include a row this page would not show is not expressible here.
  const { data: rows, error } = await context.client
    .rpc('page_inventory', {
      p_order: order,
      p_query: query,
      p_page: paging.paging.page,
      p_page_size: INVENTORY_PAGE_SIZE,
      ...filterRpcArgs(filters.filters),
    })
    .select(
      'total_count,page_number,id,property_code,listing_mode,status,cover_file_id,frontage_m,depth_m,land_area_m2,floor_area_m2,floors,direction,access_type,entry_on,entry_source,age_days',
    );
  if (error) throw accessError(error.code);
  // The read answers every page of a non-empty result set, so no rows means the filtered set is
  // empty: the total is zero and the pager states page one of one.
  const total = rows?.length ? rows[0]!.total_count : 0;
  const page = rows?.length ? rows[0]!.page_number : 1;
  const summary = { total, page, order };
  if (!rows?.length) return { ...summary, properties: [] };
  const addresses = await addressSummaries(
    context,
    rows.map((row) => row.id),
    query,
  );
  return {
    ...summary,
    properties: rows.map((row) => ({
      id: row.id,
      propertyCode: row.property_code,
      listingMode: row.listing_mode,
      status: row.status,
      coverFileId: row.cover_file_id ?? null,
      // Kept as the database returned them; the plate coerces for the drawing.
      frontageM: row.frontage_m ?? null,
      depthM: row.depth_m ?? null,
      landAreaM2: row.land_area_m2 ?? null,
      floorAreaM2: row.floor_area_m2 ?? null,
      floors: row.floors ?? null,
      direction: row.direction ?? null,
      accessType: row.access_type ?? null,
      entryOn: row.entry_on ?? null,
      entrySource: row.entry_source,
      ageDays: row.age_days ?? null,
      addresses: addresses.get(row.id) ?? [],
    })),
  };
}

function accessError(code: string | undefined): ApiError {
  return code === '42501'
    ? new ApiError(403, 'access-denied')
    : new ApiError(503, 'unavailable');
}

// The province must be a province-level catalog unit and the ward a commune-level unit inside
// that province, so an address that swaps or mismatches them is refused rather than applied to a
// different unit.
async function assertAreaUnits(
  context: RouteContext,
  filters: InventoryFilters,
): Promise<void> {
  const { province, ward } = filters;
  if (province === null && ward === null) return;
  const { data, error } = await context.client
    .from('admin_unit_versions')
    .select('id,unit_level,parent_id')
    .in(
      'id',
      [province, ward].filter((id): id is string => id !== null),
    );
  if (error) throw new ApiError(503, 'unavailable');
  if (!catalogUnitsMatch(data ?? [], filters))
    throw new ApiError(400, 'invalid-input');
}

// A contact the address states must be a readable recorded identity. The `contacts` read is the
// caller's own RLS (`member_read`), so an identifier that names no readable contact is refused
// exactly as the area check refuses an absent catalog unit, instead of silently matching an
// empty inventory.
async function assertContact(
  context: RouteContext,
  filters: InventoryFilters,
): Promise<void> {
  if (filters.contact === null) return;
  const { data, error } = await context.client
    .from('contacts')
    .select('id')
    .eq('id', filters.contact)
    .maybeSingle();
  if (error) throw new ApiError(503, 'unavailable');
  if (!data) throw new ApiError(400, 'invalid-input');
}

async function addressSummaries(
  context: RouteContext,
  ids: string[],
  query: string,
): Promise<Map<string, AddressSummary[]>> {
  const result = new Map<string, AddressSummary[]>();
  if (!ids.length) return result;
  const { data: addresses, error } = await context.client
    .from('property_addresses')
    .select(
      'id,property_id,format,address_text,mapping_status,is_primary,search_text',
    )
    .in('property_id', ids)
    .order('is_primary', { ascending: false })
    .order('id');
  if (error) throw new ApiError(503, 'unavailable');
  const byProperty = new Map<string, AddressSummary[]>();
  const matching = new Map<string, AddressSummary[]>();
  const normalized = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('đ', 'd');
  for (const address of addresses ?? []) {
    const summary: AddressSummary = {
      id: address.id,
      format: address.format,
      addressText: address.address_text,
      mappingStatus: address.mapping_status,
      isPrimary: address.is_primary,
    };
    const group = byProperty.get(address.property_id) ?? [];
    group.push(summary);
    byProperty.set(address.property_id, group);
    if (normalized.trim() && address.search_text.includes(normalized)) {
      const hits = matching.get(address.property_id) ?? [];
      hits.push(summary);
      matching.set(address.property_id, hits);
    }
  }
  for (const id of ids)
    result.set(id, matching.get(id) ?? byProperty.get(id) ?? []);
  return result;
}
