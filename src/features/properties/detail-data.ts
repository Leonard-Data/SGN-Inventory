import 'server-only';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import { creatorName } from './creator';
export async function propertyDetail(context: RouteContext, id: string) {
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  // PostgREST casts money before JSON serialization: never round numeric(18,0) in JS.
  const { data: property, error } = await context.client
    .from('properties')
    .select(
      'id,revision,property_code,listing_mode,property_type,access_type,status,record_review_status,legal_status,sale_price_vnd::text,monthly_rent_vnd::text,land_area_m2::text,frontage_m::text,depth_m::text,floor_area_m2::text,floors,bedrooms,bathrooms,direction,ownership_type,parcel_number,map_sheet_number,construction_text,area_raw,notes,latitude::text,longitude::text,updated_at,archived_at,cover_file_id,created_by',
    )
    .eq('id', id)
    .maybeSingle();
  if (error)
    throw new ApiError(
      error.code === '42501' ? 403 : 503,
      error.code === '42501' ? 'access-denied' : 'unavailable',
    );
  if (!property) throw new ApiError(404, 'not-found');
  // The record already carries the employee who created it, so its display name is one read
  // of that colleague's name inside the same parallel batch: no second source of attribution
  // and no wider visibility than the property read itself. The cheap null check runs first, so
  // a record with no creator costs no request, and an unreadable creator resolves to no name.
  const creatorRead: PromiseLike<string | null> = property.created_by
    ? context.client
        .rpc('list_employee_names', { p_ids: [property.created_by] })
        .then(({ data, error }) =>
          error ? null : (data?.[0]?.display_name ?? null),
        )
    : Promise.resolve(null);
  const [addressResult, contactResult, creatorDisplayName] = await Promise.all([
    context.client
      .from('property_addresses')
      .select(
        'id,revision,format,address_text,house_number,street,province_text,district_text,commune_text,province_unit_id,district_unit_id,commune_unit_id,mapping_status,verification_method,verified_by,verified_at,source_url,effective_on,mapping_evidence,is_primary,supersedes_address_id',
      )
      .eq('property_id', id)
      .order('is_primary', { ascending: false })
      .order('id'),
    context.client
      .from('property_contacts')
      .select(
        'contact_id,revision,relation,is_primary,contacts(id,revision,display_name,phones,raw_phone_text,contact_type,notes)',
      )
      .eq('property_id', id)
      .order('is_primary', { ascending: false })
      .order('contact_id'),
    creatorRead,
  ]);
  if (addressResult.error || contactResult.error)
    throw new ApiError(503, 'unavailable');
  return {
    property,
    addresses: addressResult.data ?? [],
    contacts: contactResult.data ?? [],
    // A creator that is missing or was not readable leaves the fact out of the page rather
    // than showing a placeholder or an identifier.
    creatorName: creatorName(creatorDisplayName),
  };
}
export type PropertyDetail = Awaited<ReturnType<typeof propertyDetail>>;
