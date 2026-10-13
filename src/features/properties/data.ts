import 'server-only';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import type { AddressSummary, PropertyPage, PropertySummary } from './types';
import {
  ageCursorArgs,
  decodeAgeCursor,
  encodeAgeCursor,
  isInventoryOrder,
  type InventoryOrder,
} from './age-cursor';

export async function browseProperties(
  context: RouteContext,
  params: URLSearchParams,
): Promise<PropertyPage> {
  const query = params.get('query') ?? '';
  const after = params.get('after');
  const sort = params.get('sort');
  if ([...query].length > 120) throw new ApiError(400, 'query-too-long');
  if (sort !== null && !isInventoryOrder(sort))
    throw new ApiError(400, 'invalid-input');
  const allowed =
    sort === null ? ['query', 'after'] : ['query', 'after', 'sort'];
  if ([...params.keys()].some((key) => !allowed.includes(key)))
    throw new ApiError(400, 'invalid-input');
  // The chronological views are a distinct bounded read over eligible inventory; the ordinary
  // UUID-ordered browse keeps serving the full unarchived inventory.
  if (sort) return listInventoryByAge(context, sort, query, after);
  if (after !== null && !uuid(after)) throw new ApiError(400, 'invalid-input');
  const { data: rows, error } = await context.client
    .rpc('search_properties', {
      p_query: query,
      p_limit: 30,
      ...(after ? { p_after: after } : {}),
    })
    .select(
      'id,property_code,listing_mode,status,cover_file_id,frontage_m::text,depth_m::text,land_area_m2::text,floor_area_m2::text,floors,direction,access_type',
    );
  if (error) throw accessError(error.code);
  if (!rows?.length) return { properties: [], nextCursor: null };
  const addresses = await addressSummaries(
    context,
    rows.map((row) => row.id),
    query,
  );
  return {
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
      addresses: addresses.get(row.id) ?? [],
    })),
    nextCursor: rows.length === 30 ? rows[rows.length - 1]!.id : null,
  };
}

// The eligible oldest-first/newest-first inventory read. The database orders and ages the rows
// in Vietnam time and returns the date+identity key; the browser only carries that key.
async function listInventoryByAge(
  context: RouteContext,
  order: InventoryOrder,
  query: string,
  after: string | null,
): Promise<PropertyPage> {
  const decoded = decodeAgeCursor(after);
  if (!decoded.ok) throw new ApiError(400, 'invalid-input');
  const { data: rows, error } = await context.client.rpc(
    'list_inventory_by_age',
    {
      p_direction: order,
      p_query: query,
      p_limit: 30,
      ...ageCursorArgs(decoded.cursor),
    },
  );
  if (error) throw accessError(error.code);
  if (!rows?.length) return { order, properties: [], nextCursor: null };
  const addresses = await addressSummaries(
    context,
    rows.map((row) => row.id),
    query,
  );
  const properties: PropertySummary[] = rows.map((row) => ({
    id: row.id,
    propertyCode: row.property_code,
    listingMode: row.listing_mode,
    status: row.status,
    coverFileId: row.cover_file_id ?? null,
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
  }));
  const last = properties[properties.length - 1]!;
  return {
    order,
    properties,
    // A full page can have a following page; the cursor is opaque to the browser and carries
    // the ordering section, so an unknown-date page continues from its own identity.
    nextCursor:
      rows.length === 30
        ? encodeAgeCursor({ entryOn: last.entryOn ?? null, id: last.id })
        : null,
  };
}

function accessError(code: string | undefined): ApiError {
  return code === '42501'
    ? new ApiError(403, 'access-denied')
    : new ApiError(503, 'unavailable');
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
