import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import type { Database } from '@/types/database';
import { CURRENT_CATALOG_START } from '@/features/property-maintenance/units';
import type { AddressSummary, PropertyStream } from './types';
import { propertyCreators, propertyModifiers } from './creator';
import {
  catalogUnitsMatch,
  filterRpcArgs,
  INVENTORY_FILTER_KEYS,
  parseInventoryFilters,
  type InventoryFilters,
} from './filters';
import {
  isInventoryOrder,
  parseStreamOffset,
  STREAM_PAGE_SIZE,
  type InventoryOrder,
} from './stream';

// One row of the stream read. The counting row a past-the-end or empty window answers with carries
// null window columns, so a row names a property exactly when it has an id; when it does, the four
// fields the summary requires are present because they are NOT NULL on the table the window was
// sliced from, and the left join cannot null a row it did not join.
type StreamRow =
  Database['public']['Functions']['stream_inventory']['Returns'][number];
type StreamRecord = StreamRow & {
  id: string;
  property_code: string;
  listing_mode: string;
  status: string;
  property_type: string;
};

export async function browseProperties(
  context: RouteContext,
  params: URLSearchParams,
): Promise<PropertyStream> {
  const query = params.get('query') ?? '';
  const sort = params.get('sort');
  if ([...query].length > 120) throw new ApiError(400, 'query-too-long');
  if (sort !== null && !isInventoryOrder(sort))
    throw new ApiError(400, 'invalid-input');
  // A filter the address states must be applied or refused; it is never dropped into a
  // different inventory than the one the address describes.
  const filters = parseInventoryFilters(params);
  if (!filters.ok) throw new ApiError(400, 'invalid-input');
  // The creator selection is answered from the loaded catalogue, which is the only place a record's
  // creator is already known; this read carries no creator criterion, so a caller asking for one is
  // refused instead of being answered with an inventory that ignores it.
  if (filters.filters.createdBy !== null)
    throw new ApiError(400, 'invalid-input');
  // The window offset is read the same way: a mangled or negative value is refused rather than
  // quietly served as a different window than the caller asked for.
  const window = parseStreamOffset(params);
  if (!window.ok) throw new ApiError(400, 'invalid-input');
  // The retired page number and page size are not parameters of the stream: a caller that still
  // sends them is refused instead of being answered with a different window of inventory, and the
  // window offset is the stream's own parameter.
  const allowed = [
    'query',
    'offset',
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
  // One filtered read returns the matching total beside this window of rows, at the window's own
  // offset in the stream's total order. The ordering is the argument, so the ordinary browse and
  // the eligible chronology share one predicate: a count that could include a row this window
  // would not show is not expressible here.
  const { data: rows, error } = await context.client
    .rpc('stream_inventory', {
      p_order: order,
      p_query: query,
      p_offset: window.offset,
      p_limit: STREAM_PAGE_SIZE,
      ...filterRpcArgs(filters.filters),
    })
    .select(
      'total_count,id,property_code,listing_mode,status,property_type,cover_file_id,frontage_m,depth_m,land_area_m2,floor_area_m2,floors,direction,access_type,entry_on,entry_source,age_days,created_at,updated_at,sale_price_vnd,monthly_rent_vnd',
    );
  if (error) throw accessError(error.code);
  // Every read states the total: a window past the end answers with the counting row alone, so
  // the header count stays true even when the window it asked for has no rows.
  const total = rows?.length ? rows[0]!.total_count : 0;
  const summary = { total, offset: window.offset, order };
  // The counting row a past-the-end or empty window answers with carries no record: the rest of
  // this read only makes sense for rows that name a property.
  const records = (rows ?? []).filter(
    (row): row is StreamRecord => row.id !== null,
  );
  if (!records.length) return { ...summary, properties: [] };
  const ids = records.map((row) => row.id);
  // Both reads depend only on the window of rows, so they run together: the addresses the rows
  // draw, and the display name of each record's creator and modifier.
  const [addresses, attribution] = await Promise.all([
    addressSummaries(context, ids, query),
    attributionNames(context, ids),
  ]);
  return {
    ...summary,
    properties: records.map((row) => ({
      id: row.id,
      propertyCode: row.property_code,
      listingMode: row.listing_mode,
      status: row.status,
      propertyType: row.property_type,
      salePriceVnd: row.sale_price_vnd ?? null,
      monthlyRentVnd: row.monthly_rent_vnd ?? null,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
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
      createdBy: attribution.creators.get(row.id) ?? null,
      updatedBy: attribution.modifiers.get(row.id) ?? null,
    })),
  };
}

// The creator's and the modifier's display names ride on the same page of records rather than on a
// second source: the page ids address properties the caller may already read, and an employee's
// display name is the attribution every active employee can read. Nothing here widens who can see
// what, and a reference that does not resolve simply contributes no entry.
async function attributionNames(
  context: RouteContext,
  ids: string[],
): Promise<{
  creators: Map<string, string>;
  modifiers: Map<string, string>;
}> {
  const { data: records, error } = await context.client
    .from('properties')
    .select('id,created_by,updated_by')
    .in('id', ids);
  if (error) throw accessError(error.code);
  // One pass over the page: the referenced ids, de-duplicated, without a second traversal.
  const referenced = [
    ...new Set(
      (records ?? []).flatMap((record) =>
        [record.created_by, record.updated_by].flatMap((id) =>
          id ? [id] : [],
        ),
      ),
    ),
  ];
  const empty = { creators: new Map(), modifiers: new Map() };
  if (!referenced.length) return empty;
  const { data: employees, error: employeeError } = await context.client.rpc(
    'list_employee_names',
    { p_ids: referenced },
  );
  if (employeeError) throw accessError(employeeError.code);
  return {
    creators: propertyCreators(records ?? [], employees ?? []),
    modifiers: propertyModifiers(records ?? [], employees ?? []),
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
    )
    .gte('valid_from', CURRENT_CATALOG_START);
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
      'id,property_id,format,address_text,mapping_status,is_primary,house_number,street,commune_text,district_text,search_text',
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
      // The recorded address text is preserved as entered; these parts are what the table's own
      // columns state, and an absent part stays absent instead of being parsed out of the text.
      houseNumber: address.house_number,
      street: address.street,
      commune: address.commune_text,
      district: address.district_text,
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
