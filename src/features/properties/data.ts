import 'server-only';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import type { PropertyPage } from './types';
export async function browseProperties(
  context: RouteContext,
  params: URLSearchParams,
): Promise<PropertyPage> {
  const query = params.get('query') ?? '';
  const after = params.get('after');
  if ([...query].length > 120) throw new ApiError(400, 'query-too-long');
  if (after !== null && !uuid(after)) throw new ApiError(400, 'invalid-input');
  if ([...params.keys()].some((key) => !['query', 'after'].includes(key)))
    throw new ApiError(400, 'invalid-input');
  const { data: rows, error } = await context.client
    .rpc('search_properties', {
      p_query: query,
      p_limit: 30,
      ...(after ? { p_after: after } : {}),
    })
    .select('id,property_code,listing_mode,status,cover_file_id');
  if (error)
    throw new ApiError(
      error.code === '42501' ? 403 : 503,
      error.code === '42501' ? 'access-denied' : 'unavailable',
    );
  if (!rows?.length) return { properties: [], nextCursor: null };
  const { data: addresses, error: addressError } = await context.client
    .from('property_addresses')
    .select(
      'id,property_id,format,address_text,mapping_status,is_primary,search_text',
    )
    .in(
      'property_id',
      rows.map((row) => row.id),
    )
    .order('is_primary', { ascending: false })
    .order('id');
  if (addressError) throw new ApiError(503, 'unavailable');
  const byProperty = new Map<
    string,
    PropertyPage['properties'][number]['addresses']
  >();
  const matching = new Map<
    string,
    PropertyPage['properties'][number]['addresses']
  >();
  const normalized = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('đ', 'd');
  for (const address of addresses ?? []) {
    const group = byProperty.get(address.property_id) ?? [];
    group.push({
      id: address.id,
      format: address.format,
      addressText: address.address_text,
      mappingStatus: address.mapping_status,
      isPrimary: address.is_primary,
    });
    if (normalized.trim() && address.search_text.includes(normalized)) {
      const matches = matching.get(address.property_id) ?? [];
      matches.push(group[group.length - 1]!);
      matching.set(address.property_id, matches);
    }
    byProperty.set(address.property_id, group);
  }
  return {
    properties: rows.map((row) => ({
      id: row.id,
      propertyCode: row.property_code,
      listingMode: row.listing_mode,
      status: row.status,
      coverFileId: row.cover_file_id ?? null,
      addresses: matching.get(row.id) ?? byProperty.get(row.id) ?? [],
    })),
    nextCursor: rows.length === 30 ? rows[rows.length - 1]!.id : null,
  };
}
