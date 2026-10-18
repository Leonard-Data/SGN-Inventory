import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import {
  DIRECTORY_PAGE_SIZE,
  DirectoryError,
  directoryInvitations,
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
    .select(
      'id,display_name,email,role,auth_user_id,is_active,account_deleted_at',
    )
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
  // Newest first, so the first operation of each kind returned for an employee is the one
  // displayed. Both lifecycle kinds share the table, so each is projected separately.
  const { data: operations, error: operationError } = await context.client
    .from('employee_admin_operations')
    .select('employee_id,kind,state,revision,updated_at,provider_outcome')
    .in('employee_id', ids)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (operationError)
    throw new ApiError(
      operationError.code === '42501' ? 403 : 503,
      operationError.code === '42501' ? 'access-denied' : 'unavailable',
    );
  const rows = operations ?? [];
  const states = {
    deactivation: directoryOperations(rows, 'deactivate'),
    deletion: directoryOperations(rows, 'delete'),
  };
  // Newest first, so the first invitation returned for an employee is the one displayed.
  const { data: invitations, error: invitationError } = await context.client
    .from('employee_invitations')
    .select('employee_id,state,revision,updated_at')
    .in('employee_id', ids)
    .order('requested_at', { ascending: false })
    .order('id', { ascending: false });
  if (invitationError)
    throw new ApiError(
      invitationError.code === '42501' ? 403 : 503,
      invitationError.code === '42501' ? 'access-denied' : 'unavailable',
    );
  const invited = directoryInvitations(invitations ?? []);
  return {
    ...page,
    employees: page.employees.map((employee) => ({
      ...employee,
      deactivation: states.deactivation.get(employee.id) ?? null,
      deletion: states.deletion.get(employee.id) ?? null,
      invitation: invited.get(employee.id) ?? null,
    })),
  };
}
