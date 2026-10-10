import 'server-only';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
export async function propertyDetail(context: RouteContext, id: string) {
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  // PostgREST casts money before JSON serialization: never round numeric(18,0) in JS.
  const { data: property, error } = await context.client
    .from('properties')
    .select(
      'id,property_code,listing_mode,property_type,access_type,status,record_review_status,legal_status,sale_price_vnd::text,monthly_rent_vnd::text,land_area_m2,frontage_m,depth_m,floor_area_m2,floors,bedrooms,bathrooms,direction,updated_at,archived_at',
    )
    .eq('id', id)
    .maybeSingle();
  if (error)
    throw new ApiError(
      error.code === '42501' ? 403 : 503,
      error.code === '42501' ? 'access-denied' : 'unavailable',
    );
  if (!property) throw new ApiError(404, 'not-found');
  const [addressResult, contactResult] = await Promise.all([
    context.client
      .from('property_addresses')
      .select('id,format,address_text,mapping_status,is_primary')
      .eq('property_id', id)
      .order('is_primary', { ascending: false })
      .order('id'),
    context.client
      .from('property_contacts')
      .select(
        'relation,is_primary,contacts(id,display_name,phones,raw_phone_text)',
      )
      .eq('property_id', id)
      .order('is_primary', { ascending: false })
      .order('contact_id'),
  ]);
  if (addressResult.error || contactResult.error)
    throw new ApiError(503, 'unavailable');
  return {
    property,
    addresses: addressResult.data ?? [],
    contacts: contactResult.data ?? [],
  };
}
export type PropertyDetail = Awaited<ReturnType<typeof propertyDetail>>;
