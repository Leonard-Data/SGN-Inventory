import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';

export async function requireReadableProperty(
  context: RouteContext,
  propertyId: string,
) {
  const { data, error } = await context.client
    .from('properties')
    .select('id')
    .eq('id', propertyId)
    .maybeSingle();
  if (error) {
    if (error.code === '42501') throw new ApiError(403, 'access-denied');
    throw new ApiError(503, 'unavailable');
  }
  if (!data) throw new ApiError(404, 'property-not-found');
}
