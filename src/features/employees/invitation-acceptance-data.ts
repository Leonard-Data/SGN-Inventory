import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import { createEmployeeAdminClient } from './provider-ban';
import { invitationFromRow } from './invitation';
import {
  acceptanceBody,
  acceptanceSessionBody,
  parseAcceptedEmployee,
  type AcceptanceInput,
  type AcceptedEmployee,
} from './invitation-acceptance';

// Issue #69: the session-scoped acceptance journey. The invitee's own session is the
// authority; the recorded invitation is read through the server-only admin client (service
// role) because the ordinary read policy is live-admin-only, and the linking/activation runs
// through the guarded invoker RPC with the caller's publishable-key client, so no browser can
// claim an acceptance or invent one.
function databaseError(error: { code?: string }): ApiError {
  return error.code === '42501'
    ? new ApiError(403, 'access-denied')
    : new ApiError(503, 'unavailable');
}

// Each business refusal has its own code; the routes map them to localized messages.
function workflowError(error: { code?: string }): ApiError {
  if (error.code === '42501') return new ApiError(403, 'access-denied');
  if (error.code === '23514') return new ApiError(400, 'invalid-input');
  if (error.code === 'P0023') return new ApiError(409, 'invitation-changed');
  if (error.code === 'P0024')
    return new ApiError(409, 'invitation-not-accepted');
  if (error.code === 'P0025')
    return new ApiError(409, 'invitation-identity-mismatch');
  if (error.code === 'PT409') return new ApiError(409, 'invitation-stale');
  return new ApiError(503, 'unavailable');
}

export type InvitationSetup = {
  invitationId: string;
  revision: number;
  email: string;
  role: string;
};

export type InvitationSessionStatus =
  | { status: 'setup'; setup: InvitationSetup }
  | { status: 'active'; employee: AcceptedEmployee };

// The delivered link carries the invite session in its fragment (implicit flow); the client
// reads the fragment and posts the two tokens here, where the session is established with the
// user's own publishable-key client. A revisit with an already-signed-in cookie session posts
// nothing. Neither token is logged or cached.
export async function establishInvitationSession(
  context: RouteContext,
  body: Record<string, unknown>,
): Promise<void> {
  const input = acceptanceSessionBody(body);
  if (!input) throw new ApiError(400, 'invalid-input');
  if (input.kind === 'tokens') {
    const { error } = await context.client.auth.setSession({
      access_token: input.accessToken,
      refresh_token: input.refreshToken,
    });
    if (error) throw new ApiError(401, 'invitation-invalid');
  }
  const {
    data: { user },
    error,
  } = await context.client.auth.getUser();
  if (
    error &&
    (error.name === 'AuthRetryableFetchError' || (error.status ?? 0) >= 500)
  )
    throw new ApiError(503, 'unavailable');
  if (error || !user) throw new ApiError(401, 'invitation-invalid');
}

// The recorded invitation for the caller's own sign-in identity, read through the server-only
// admin client, together with the retained employee's live state. This decides whether the
// invitee is still on the setup step, already active, or must be refused without authority.
export async function invitationSessionStatus(
  context: RouteContext,
): Promise<InvitationSessionStatus> {
  const {
    data: { user },
  } = await context.client.auth.getUser();
  if (!user) throw new ApiError(401, 'invitation-invalid');
  const admin = createEmployeeAdminClient(context.environment);
  if (!admin) throw new ApiError(503, 'provider-unavailable');
  const { data, error } = await admin
    .from('employee_invitations')
    .select(
      'id,employee_id,actor_id,email,role,state,revision,provider_outcome,provider_detail,provider_attempted_at,requested_at,recorded_at',
    )
    .eq('provider_user_id', user.id)
    .order('requested_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw databaseError(error);
  const invitation = data?.[0] ? invitationFromRow(data[0]) : null;
  if (data?.[0] && !invitation) throw new ApiError(503, 'unavailable');
  if (!invitation) throw new ApiError(409, 'invitation-not-found');
  if (invitation.state !== 'recorded')
    throw new ApiError(409, 'invitation-not-accepted');
  const { data: employee, error: employeeError } = await admin
    .from('employees')
    .select(
      'id,display_name,email,role,auth_user_id,is_active,account_deleted_at,preferred_locale',
    )
    .eq('id', invitation.employeeId)
    .maybeSingle();
  if (employeeError) throw databaseError(employeeError);
  if (!employee) throw new ApiError(409, 'invitation-changed');
  if (employee.account_deleted_at)
    throw new ApiError(409, 'invitation-changed');
  if (employee.auth_user_id === user.id && employee.is_active) {
    return {
      status: 'active',
      employee: {
        id: employee.id,
        displayName: employee.display_name,
        email: employee.email,
        role: employee.role as AcceptedEmployee['role'],
        locale: employee.preferred_locale === 'en' ? 'en' : 'vi',
      },
    };
  }
  if (employee.auth_user_id !== null)
    throw new ApiError(409, 'invitation-changed');
  return {
    status: 'setup',
    setup: {
      invitationId: invitation.id,
      revision: invitation.revision,
      email: invitation.email,
      role: invitation.role,
    },
  };
}

// The guarded acceptance: validate the session and inputs, set the credential, then link and
// activate through the invoker RPC. The RPC re-derives the caller's identity and checks the
// recorded invitation, its revision and the still-unlinked, live employee, so a repeated or
// interrupted setup can never assign the invitation to another person or role.
export async function acceptInvitation(
  context: RouteContext,
  body: Record<string, unknown>,
): Promise<AcceptedEmployee> {
  const input: AcceptanceInput | null = acceptanceBody(body);
  if (!input) throw new ApiError(400, 'invalid-input');
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
  if (authError || !user) throw new ApiError(401, 'invitation-invalid');
  const { error: passwordError } = await context.client.auth.updateUser({
    password: input.password,
  });
  if (passwordError) throw new ApiError(503, 'unavailable');
  const { data, error } = await context.client.rpc(
    'accept_employee_invitation',
    {
      p_invitation_id: input.invitationId,
      p_revision: input.revision,
      p_display_name: input.name,
    },
  );
  if (error) throw workflowError(error);
  const employee = parseAcceptedEmployee(data);
  if (!employee) throw new ApiError(503, 'unavailable');
  context.setLocale(input.locale);
  return employee;
}
