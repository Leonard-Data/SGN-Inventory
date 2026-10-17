import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import type { Database } from '@/types/database';
import type { Employee } from './types';
import { activeEmployee } from './access';
import {
  administerInvitation,
  invitationFromRow,
  parseInvitation,
  type EmployeeRole,
  type InvitationGateway,
  type InvitationRecord,
} from './invitation';
import { createEmployeeAdminClient } from './provider-ban';
import { supabaseInvitationSender } from './provider-invite';

// Issue #68: the session-scoped read and the guarded invitation call. The recorded state and
// the authorized transitions run through the two guarded RPCs with the caller's
// publishable-key client; the server-only secret client is used for nothing except the exact
// invitation the recorded address asks for and recording its provider outcome, so no browser
// can claim an accepted invitation or invent one.
function databaseError(error: { code?: string }): ApiError {
  return error.code === '42501'
    ? new ApiError(403, 'access-denied')
    : new ApiError(503, 'unavailable');
}

// The database reports each distinct business refusal with its own code; the route maps them
// to actionable localized messages instead of one generic failure.
function workflowError(error: { code?: string }): ApiError {
  if (error.code === '42501') return new ApiError(403, 'access-denied');
  if (error.code === '23505')
    return new ApiError(409, 'invitation-key-conflict');
  if (error.code === '23514') return new ApiError(400, 'invalid-input');
  if (error.code === 'P0020')
    return new ApiError(409, 'invitation-email-recorded');
  if (error.code === 'P0021')
    return new ApiError(409, 'invitation-already-recorded');
  if (error.code === 'P0022')
    return new ApiError(409, 'invitation-role-conflict');
  if (error.code === 'P0023') return new ApiError(409, 'invitation-changed');
  if (error.code === 'PT409') return new ApiError(409, 'invitation-stale');
  return new ApiError(503, 'unavailable');
}

// The gateway talks to the two guarded RPCs only. `begin` uses the caller's session, so the
// live-admin check, the recorded role and the retained employee identity are decided in the
// database; `record` is server-only because provider acceptance must never be claimable from
// a browser.
function databaseGateway(
  context: RouteContext,
  admin: SupabaseClient<Database> | null,
): InvitationGateway {
  return {
    async begin(email, role, key) {
      const { data, error } = await context.client.rpc(
        'begin_employee_invitation',
        { p_email: email, p_role: role, p_key: key },
      );
      if (error) throw workflowError(error);
      const invitation = parseInvitation(data);
      if (!invitation) throw new ApiError(503, 'unavailable');
      return invitation;
    },
    async record(request) {
      if (!admin) throw new ApiError(503, 'provider-unavailable');
      const { data, error } = await admin.rpc(
        'record_employee_invitation_result',
        {
          p_invitation_id: request.invitationId,
          p_revision: request.revision,
          p_actor_id: request.actorId,
          p_email: request.email,
          p_outcome: request.result.outcome,
          p_provider_user_id:
            request.result.outcome === 'accepted'
              ? request.result.providerUserId
              : null,
          p_detail:
            request.result.outcome === 'accepted'
              ? null
              : request.result.detail,
        },
      );
      if (error) throw workflowError(error);
      const invitation = parseInvitation(data);
      if (!invitation) throw new ApiError(503, 'unavailable');
      return invitation;
    },
  };
}

// The recorded invitation for one normalized address. This is both the pre-submission check
// and the reconciliation read after an ambiguous response: the admin sees what the database
// recorded instead of what the browser hoped happened.
export async function loadInvitation(
  context: RouteContext,
  email: string,
): Promise<InvitationRecord> {
  const { data: employee, error } = await context.client
    .from('employees')
    .select('id,display_name,email,role')
    .eq('email', email)
    .maybeSingle();
  if (error) throw databaseError(error);
  if (!employee) return { employee: null, invitation: null };
  const { data, error: invitationError } = await context.client
    .from('employee_invitations')
    .select(
      'id,employee_id,actor_id,email,role,state,revision,provider_outcome,provider_detail,provider_attempted_at,requested_at,recorded_at',
    )
    .eq('employee_id', employee.id)
    .order('requested_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (invitationError) throw databaseError(invitationError);
  const latest = data?.[0] as Record<string, unknown> | undefined;
  const invitation = latest ? invitationFromRow(latest) : null;
  if (latest && !invitation) throw new ApiError(503, 'unavailable');
  return {
    employee: {
      id: employee.id,
      displayName: employee.display_name,
      email: employee.email,
      role: employee.role,
    },
    invitation,
  };
}

// The guarded action: record the intended invitation first, then have the server-only adapter
// send exactly one invitation to that recorded address and record the provider outcome. A
// missing server secret fails closed with the invitation left open rather than claiming
// anything about sending — except for an already recorded invitation, which needs no provider
// call and is returned as it is, so reconciliation never depends on the provider capability.
// A recorded invitation is never re-sent or activated here.
export async function administerEmployeeInvitation(
  context: RouteContext,
  actor: Employee,
  input: { email: string; role: EmployeeRole; key: string },
): Promise<InvitationRecord> {
  const admin = createEmployeeAdminClient(context.environment);
  const gateway = databaseGateway(context, admin);
  if (!admin) {
    const invitation = await gateway.begin(input.email, input.role, input.key);
    if (invitation.state !== 'recorded')
      throw new ApiError(503, 'provider-unavailable');
    await activeEmployee(context);
    return loadInvitation(context, input.email);
  }
  await administerInvitation(
    gateway,
    supabaseInvitationSender(admin, context.environment.appUrl),
    { ...input, actorId: actor.id },
  );
  // Re-read live membership after the provider call: an admin who invited their own address
  // gets the normal denial path instead of a 404 for the now-unreadable employee row.
  await activeEmployee(context);
  return loadInvitation(context, input.email);
}
