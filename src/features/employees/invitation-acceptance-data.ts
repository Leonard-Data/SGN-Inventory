import 'server-only';
import type { User } from '@supabase/supabase-js';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import { createEmployeeAdminClient } from './provider-ban';
import { invitationFromRow } from './invitation';
import {
  acceptanceBody,
  acceptanceSessionBody,
  classifyAuthFailure,
  isSamePasswordRefusal,
  type AcceptanceInput,
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
};

export type InvitationSessionStatus =
  { status: 'setup'; setup: InvitationSetup } | { status: 'active' };

// A transient Auth/provider failure is retryable, not a refusal of the invitation.
function authFailure(error: { name?: string; status?: number }): ApiError {
  return classifyAuthFailure(error) === 'retryable'
    ? new ApiError(503, 'unavailable')
    : new ApiError(401, 'invitation-invalid');
}

async function invitationUser(context: RouteContext) {
  const {
    data: { user },
    error,
  } = await context.client.auth.getUser();
  if (error) throw authFailure(error);
  if (!user) throw new ApiError(401, 'invitation-invalid');
  return user;
}

// The delivered link carries the invite session in its fragment (implicit flow); the client
// reads the fragment and posts the two tokens here, where the session is established with the
// user's own publishable-key client. A revisit with an already-signed-in cookie session posts
// nothing. Neither token is logged or cached.
export async function establishInvitationSession(
  context: RouteContext,
  body: Record<string, unknown>,
): Promise<{ kind: 'tokens' | 'cookie'; user: User }> {
  const input = acceptanceSessionBody(body);
  if (!input) throw new ApiError(400, 'invalid-input');
  if (input.kind === 'tokens') {
    const { error } = await context.client.auth.setSession({
      access_token: input.accessToken,
      refresh_token: input.refreshToken,
    });
    if (error) throw authFailure(error);
  }
  const user = await invitationUser(context);
  return { kind: input.kind, user };
}

// The one-time invite-flow proof. It is created only by this module's session path (the
// invitee's delivered link established the session) and consumed by the acceptance RPC, so a
// password-recovery or ordinary sign-in session for the same identity has no proof and cannot
// activate. Both calls run through the server-only admin client.
export async function recordInvitationProof(
  context: RouteContext,
  setup: InvitationSetup,
  userId: string,
): Promise<void> {
  const admin = createEmployeeAdminClient(context.environment);
  if (!admin) throw new ApiError(503, 'provider-unavailable');
  const { error } = await admin.rpc('record_employee_invitation_proof', {
    p_invitation_id: setup.invitationId,
    p_auth_user_id: userId,
    p_revision: setup.revision,
  });
  if (error) throw workflowError(error);
}

export async function invitationProofValid(
  context: RouteContext,
  setup: InvitationSetup,
  userId: string,
): Promise<boolean> {
  const admin = createEmployeeAdminClient(context.environment);
  if (!admin) throw new ApiError(503, 'provider-unavailable');
  const { data, error } = await admin.rpc('employee_invitation_proof_valid', {
    p_invitation_id: setup.invitationId,
    p_auth_user_id: userId,
  });
  if (error) throw new ApiError(503, 'unavailable');
  return data === true;
}

// The recorded invitation for the caller's own sign-in identity, read through the server-only
// admin client, together with the retained employee's live state. This decides whether the
// invitee is still on the setup step, already active, or must be refused without authority.
export async function invitationSessionStatus(
  context: RouteContext,
): Promise<InvitationSessionStatus> {
  const user = await invitationUser(context);
  const admin = createEmployeeAdminClient(context.environment);
  if (!admin) throw new ApiError(503, 'provider-unavailable');
  // The row must carry every column the invitation parser requires, including the resend
  // attempt; an omitted one makes the read look like a malformed invitation and refuses a
  // real invitee after their session was already established.
  const { data, error } = await admin
    .from('employee_invitations')
    .select(
      'id,employee_id,actor_id,email,role,state,revision,provider_outcome,provider_detail,provider_attempted_at,requested_at,recorded_at,resend_count,resend_outcome,resend_detail,resend_attempted_at',
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
    .select('auth_user_id,is_active,account_deleted_at')
    .eq('id', invitation.employeeId)
    .maybeSingle();
  if (employeeError) throw databaseError(employeeError);
  if (!employee) throw new ApiError(409, 'invitation-changed');
  if (employee.account_deleted_at)
    throw new ApiError(409, 'invitation-changed');
  const { data: deletion, error: deletionError } = await admin
    .from('employee_admin_operations')
    .select('id')
    .eq('employee_id', invitation.employeeId)
    .eq('kind', 'delete')
    .neq('state', 'completed')
    .limit(1);
  if (deletionError) throw databaseError(deletionError);
  if (deletion?.[0]) throw new ApiError(409, 'invitation-changed');
  if (employee.auth_user_id === user.id && employee.is_active)
    return { status: 'active' };
  if (employee.auth_user_id !== null)
    throw new ApiError(409, 'invitation-changed');
  return {
    status: 'setup',
    setup: {
      invitationId: invitation.id,
      revision: invitation.revision,
      email: invitation.email,
    },
  };
}

// The guarded acceptance: the caller's own recorded step decides the action. A caller the
// recorded invitation already linked and activated is returned as accepted without touching
// the credential or the RPC, so a repeated or interrupted setup converges instead of rewriting
// a live password. Otherwise the credential is set and the invoker RPC links and activates the
// exact recorded identity; the RPC re-derives the caller's identity and re-checks the recorded
// invitation, its revision and the still-unlinked, live employee, so no credentialless
// membership is left behind and no other person or role is ever assigned.
export async function acceptInvitation(
  context: RouteContext,
  body: Record<string, unknown>,
): Promise<{ status: 'accepted' }> {
  const input: AcceptanceInput | null = acceptanceBody(body);
  if (!input) throw new ApiError(400, 'invalid-input');
  const user = await invitationUser(context);
  const step = await invitationSessionStatus(context);
  if (step.status === 'active') {
    context.setLocale(input.locale);
    return { status: 'accepted' };
  }
  // P1: refusal happens before the credential is written, using the same invite-flow proof the
  // RPC consumes, so a recovery/ordinary session cannot set a password on this path either.
  if (!(await invitationProofValid(context, step.setup, user.id)))
    throw new ApiError(409, 'invitation-session-required');
  const { error: passwordError } = await context.client.auth.updateUser({
    password: input.password,
  });
  if (passwordError && !isSamePasswordRefusal(passwordError))
    throw classifyAuthFailure(passwordError) === 'retryable'
      ? new ApiError(503, 'unavailable')
      : new ApiError(400, 'invalid-input');
  const { data, error } = await context.client.rpc(
    'accept_employee_invitation',
    {
      p_invitation_id: input.invitationId,
      p_revision: input.revision,
      p_display_name: input.name,
    },
  );
  if (error) throw workflowError(error);
  if (!data) throw new ApiError(503, 'unavailable');
  context.setLocale(input.locale);
  return { status: 'accepted' };
}
