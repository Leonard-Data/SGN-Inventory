import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import type { Employee } from './types';
export async function activeEmployee(context: RouteContext): Promise<Employee> {
  const {
    data: { user },
    error: authError,
  } = await context.client.auth.getUser();
  if (
    authError &&
    (authError.name === 'AuthRetryableFetchError' ||
      (authError.status ?? 0) >= 500)
  )
    throw new ApiError(503, 'unavailable');
  if (!user) throw new ApiError(401, 'unauthenticated');
  const { data, error } = await context.client
    .from('employees')
    .select('id,display_name,role,preferred_locale')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (error)
    throw new ApiError(
      error.code === '42501' ? 403 : 503,
      error.code === '42501' ? 'access-denied' : 'unavailable',
    );
  if (!data) throw new ApiError(403, 'access-denied');
  if (
    data.role !== 'sales' &&
    data.role !== 'staff' &&
    data.role !== 'manager' &&
    data.role !== 'admin'
  )
    throw new ApiError(403, 'access-denied');
  return {
    id: data.id,
    displayName: data.display_name,
    role: data.role,
    locale: data.preferred_locale === 'en' ? 'en' : 'vi',
  };
}
