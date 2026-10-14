import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import {
  DIRECTORY_PAGE_SIZE,
  DirectoryError,
  directoryOperations,
  directoryPage,
  directoryQuery,
} from './directory';

// The session-scoped read behind the admin employee list. It uses the request-scoped
// publishable-key client, so the existing `employees` RLS policy still decides which rows
// are visible, and the recorded administration state is read under the live-admin policy
// instead of being inferred from the browser.
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
  const page = directoryPage(data ?? []);
  const ids = page.employees.map((employee) => employee.id);
  if (!ids.length) return page;
  // Newest first, so the first operation returned for an employee is the one displayed.
  const { data: operations, error: operationError } = await context.client
    .from('employee_admin_operations')
    .select('employee_id,state,revision,updated_at')
    .in('employee_id', ids)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (operationError)
    throw new ApiError(
      operationError.code === '42501' ? 403 : 503,
      operationError.code === '42501' ? 'access-denied' : 'unavailable',
    );
  const states = directoryOperations(operations ?? []);
  return {
    ...page,
    employees: page.employees.map((employee) => ({
      ...employee,
      deactivation: states.get(employee.id) ?? null,
    })),
  };
}
