import 'server-only';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';

export async function setCover(
  context: RouteContext,
  propertyId: string,
  fileId: string | null,
) {
  if (!uuid(propertyId) || (fileId !== null && !uuid(fileId)))
    throw new ApiError(400, 'invalid-input');

  if (fileId === null) {
    // Clear the cover
    const { error } = await context.client.rpc('clear_property_cover', {
      p_property_id: propertyId,
    });
    if (error) {
      if (error.code === '42501') throw new ApiError(403, 'access-denied');
      if (error.code === '23514') throw new ApiError(400, error.message);
      throw new ApiError(503, 'unavailable');
    }
  } else {
    // Set or replace the cover
    const { error } = await context.client.rpc('set_property_cover', {
      p_property_id: propertyId,
      p_file_id: fileId,
    });
    if (error) {
      if (error.code === '42501') throw new ApiError(403, 'access-denied');
      if (error.code === '23514') throw new ApiError(400, error.message);
      throw new ApiError(503, 'unavailable');
    }
  }
  return { status: 'ok' as const };
}
