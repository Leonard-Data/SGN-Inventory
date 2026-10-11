import 'server-only';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';

export async function setFileCategory(
  context: RouteContext,
  propertyId: string,
  fileId: string,
  categoryId: string,
): Promise<void> {
  if (!uuid(propertyId) || !uuid(fileId) || !uuid(categoryId))
    throw new ApiError(400, 'invalid-input');

  const { error } = await context.client.rpc('set_file_category', {
    p_property_id: propertyId,
    p_file_id: fileId,
    p_category_id: categoryId,
  });

  if (error) {
    if (error.code === '42501') throw new ApiError(403, 'access-denied');
    if (error.code === '23514') throw new ApiError(400, 'invalid-category');
    throw new ApiError(503, 'unavailable');
  }
}
