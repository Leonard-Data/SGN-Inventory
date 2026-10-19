import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import {
  parseMyProfile,
  parseProfileUpdate,
  type EmployeeProfileValues,
  type MyProfileValues,
  type ProfileField,
} from './profile';

// The database reports each business refusal with its own code; the routes map them to
// actionable localized messages instead of one generic failure.
export function profileError(error: { code?: string }): ApiError {
  if (error.code === '42501') return new ApiError(403, 'access-denied');
  if (error.code === '23514') return new ApiError(400, 'invalid-input');
  if (error.code === 'P0010') return new ApiError(409, 'last-admin');
  if (error.code === 'P0013') return new ApiError(404, 'not-found');
  if (error.code === 'P0014') return new ApiError(409, 'not-editable');
  return new ApiError(503, 'unavailable');
}

// The admin edit runs through the guarded RPC with the caller's publishable-key client, so live
// admin membership is re-checked in the database; the browser never supplies the actor.
export async function updateEmployeeProfile(
  context: RouteContext,
  employeeId: string,
  values: EmployeeProfileValues,
): Promise<{ changed: ProfileField[] }> {
  const { data, error } = await context.client.rpc('update_employee_profile', {
    p_employee_id: employeeId,
    p_display_name: values.displayName,
    p_phone: values.phone,
    p_role: values.role,
    p_bio: values.bio,
  });
  if (error) throw profileError(error);
  const update = parseProfileUpdate(data);
  if (!update) throw new ApiError(503, 'unavailable');
  return update;
}

// A person's own display name and bio. The call carries no employee: the guarded function
// resolves the subject from live membership, so this path cannot name anyone else.
export async function updateMyProfile(
  context: RouteContext,
  values: MyProfileValues,
): Promise<{ displayName: string; bio: string | null }> {
  const { data, error } = await context.client.rpc('update_my_profile', {
    p_display_name: values.displayName,
    p_bio: values.bio,
  });
  if (error) throw profileError(error);
  const update = parseMyProfile(data);
  if (!update) throw new ApiError(503, 'unavailable');
  return update;
}

// The profile page's own read: the signed-in person's recorded name, role and bio, scoped to
// their own employee id under the existing `employees_read` policy. It returns nothing about
// anyone else and nothing about access state, so it is not a second employee directory.
export async function loadMyProfile(
  context: RouteContext,
  employeeId: string,
  fallback: { displayName: string; role: string },
): Promise<{ displayName: string; role: string; bio: string | null }> {
  const { data, error } = await context.client
    .from('employees')
    .select('display_name,role,bio')
    .eq('id', employeeId)
    .maybeSingle();
  if (error) throw profileError(error);
  if (!data)
    return {
      displayName: fallback.displayName,
      role: fallback.role,
      bio: null,
    };
  return {
    displayName: data.display_name,
    role: data.role,
    bio: data.bio,
  };
}
