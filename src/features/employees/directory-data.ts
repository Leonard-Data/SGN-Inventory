import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import {
  DIRECTORY_PAGE_SIZE,
  DirectoryError,
  directoryPage,
  directoryQuery,
} from './directory';

// The session-scoped read behind the admin employee list. It uses the request-scoped
// publishable-key client, so the existing `employees` RLS policy still decides which rows
// are visible and no privileged fallback is introduced.
export async function listEmployees(
  context: RouteContext,
  params: URLSearchParams,
) {
  let after: string | null;
  try {
    after = directoryQuery(params).after;
  } catch (failure) {
    throw new ApiError(
      400,
      failure instanceof DirectoryError ? failure.code : 'invalid-input',
    );
  }
  let request = context.client
    .from('employees')
    .select('id,display_name,email,role,auth_user_id,is_active')
    .order('id')
    .limit(DIRECTORY_PAGE_SIZE + 1);
  if (after) request = request.gt('id', after);
  const { data, error } = await request;
  if (error)
    throw new ApiError(
      error.code === '42501' ? 403 : 503,
      error.code === '42501' ? 'access-denied' : 'unavailable',
    );
  return directoryPage(data ?? []);
}
