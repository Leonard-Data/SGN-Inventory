import 'server-only';
import { ApiError, uuid } from '@/lib/supabase/route';
import type { RouteContext } from '@/lib/supabase/route';

export async function setCover(
  context: RouteContext,
  propertyId: string,
  fileId: string | null,
) {
  if (!uuid(propertyId) || (fileId !== null && !uuid(fileId)))
    throw new ApiError(400, 'invalid-input');
  const { error } = await context.client.rpc('set_property_cover', {
    p_property_id: propertyId,
    p_file_id: fileId ?? undefined,
  });
  if (error) {
    if (error.code === '42501') throw new ApiError(403, 'access-denied');
    if (error.code === '23514') throw new ApiError(400, 'invalid-cover');
    throw new ApiError(503, 'unavailable');
  }
  return { fileId };
}
