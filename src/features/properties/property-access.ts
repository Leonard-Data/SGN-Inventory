import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import { classifyPropertyRead } from './property-access-core';

export async function requireReadableProperty(
  context: RouteContext,
  propertyId: string,
) {
  const { data, error } = await context.client
    .from('properties')
    .select('id')
    .eq('id', propertyId)
    .maybeSingle();
  const failure = classifyPropertyRead({ data, error });
  if (failure) throw new ApiError(failure.status, failure.code);
}
