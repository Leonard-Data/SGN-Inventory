import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import type { Database } from '@/types/database';
import type { Employee } from './types';
import { activeEmployee } from './access';
import { accessState } from './directory';
import {
  administerDeactivation,
  isUuid,
  outstandingReservations,
  parseDeactivationOperation,
  type DeactivationConfirmation,
  type DeactivationGateway,
  type DeactivationOperation,
  type OutstandingReservation,
} from './deactivation';
import {
  createEmployeeAdminClient,
  supabaseSignInBlocker,
} from './provider-ban';

// Issue #66: the session-scoped read and the guarded administration call. Membership changes
// and state transitions run through the two guarded RPCs with the caller's publishable-key
// client; the server-only secret client is used for nothing except the exact employee's Auth
// admin call and recording its confirmed outcome, so no browser can claim provider success.
type EmployeeTargetRow = {
  id: string;
  display_name: string;
  email: string;
  role: string;
  auth_user_id: string | null;
  is_active: boolean;
  account_deleted_at: string | null;
};

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
    return new ApiError(409, 'deactivation-key-conflict');
  if (error.code === '23514') return new ApiError(400, 'invalid-input');
  if (error.code === 'P0010') return new ApiError(409, 'last-admin');
  if (error.code === 'P0011') return new ApiError(409, 'not-deactivable');
  if (error.code === 'P0012') return new ApiError(409, 'stale-operation');
  if (error.code === 'PT409') return new ApiError(409, 'stale-operation');
  return new ApiError(503, 'unavailable');
}

function operationFromRow(
  row: Record<string, unknown>,
): DeactivationOperation | null {
  return parseDeactivationOperation({
    id: row.id,
    employeeId: row.employee_id,
    actorId: row.actor_id,
    kind: row.kind,
    state: row.state,
    revision: row.revision,
    providerOutcome: row.provider_outcome,
    providerDetail: row.provider_detail,
    providerBanUntil: row.provider_ban_until,
    membershipDisabledAt: row.membership_disabled_at,
    completedAt: row.completed_at,
  });
}

async function employeeTarget(
  context: RouteContext,
  id: string,
): Promise<EmployeeTargetRow> {
  if (!isUuid(id)) throw new ApiError(400, 'invalid-input');
  const { data, error } = await context.client
    .from('employees')
    .select(
      'id,display_name,email,role,auth_user_id,is_active,account_deleted_at',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw databaseError(error);
  if (!data) throw new ApiError(404, 'not-found');
  return data;
}

// The gateway talks to the two guarded RPCs only. `begin` uses the caller's session, so the
// live-admin check and the last-active-admin guard execute in the database. `record` is
// server-only because provider acceptance must never be claimable from a browser.
function databaseGateway(
  context: RouteContext,
  admin: SupabaseClient<Database> | null,
): DeactivationGateway {
  return {
    async begin(employeeId, key) {
      const { data, error } = await context.client.rpc(
        'begin_employee_deactivation',
        { p_employee_id: employeeId, p_key: key },
      );
      if (error) throw workflowError(error);
      const operation = parseDeactivationOperation(data);
      if (!operation) throw new ApiError(503, 'unavailable');
      return operation;
    },
    async record(request) {
      if (!admin) throw new ApiError(503, 'provider-unavailable');
      const { data, error } = await admin.rpc(
        'record_employee_deactivation_result',
        {
          p_operation_id: request.operationId,
          p_revision: request.revision,
          p_actor_id: request.actorId,
          p_auth_user_id: request.authUserId,
          p_outcome: request.result.outcome,
          p_provider_reference:
            request.result.outcome === 'blocked'
              ? request.result.reference
              : null,
          p_detail:
            request.result.outcome === 'blocked' ? null : request.result.detail,
          p_ban_until:
            request.result.outcome === 'blocked'
              ? request.result.banUntil
              : null,
        },
      );
      if (error) throw workflowError(error);
      const operation = parseDeactivationOperation(data);
      if (!operation) throw new ApiError(503, 'unavailable');
      return operation;
    },
  };
}

// Approved-unexpired reservations are effective and pending requests do not reserve. Access
// removal only makes their existence visible; neither is ever reassigned, so release or
// expiry stays with the existing claimant, reviewer and expiry rules. Shared with account
// deletion, which removes access the same way.
export async function outstandingReservationsFor(
  context: RouteContext,
  employeeId: string,
): Promise<OutstandingReservation[]> {
  const { data, error } = await context.client
    .from('property_locks')
    .select('id,property_id,status,expires_at')
    .eq('requested_by', employeeId)
    .in('status', ['pending', 'approved'])
    .gt('expires_at', new Date().toISOString())
    .order('expires_at');
  if (error) throw databaseError(error);
  const lockRows = data ?? [];
  const propertyIds = [...new Set(lockRows.map((row) => row.property_id))];
  const codes = new Map<string, string>();
  if (propertyIds.length) {
    const { data: properties, error: propertyError } = await context.client
      .from('properties')
      .select('id,property_code')
      .in('id', propertyIds);
    if (propertyError) throw databaseError(propertyError);
    for (const row of properties ?? []) codes.set(row.id, row.property_code);
  }
  return outstandingReservations(
    lockRows.map((row) => ({
      id: row.id,
      property_id: row.property_id,
      status: row.status,
      expires_at: row.expires_at,
      properties: { property_code: codes.get(row.property_id) ?? '' },
    })),
    new Date(),
  );
}

// The confirmation the admin list opens: target identity, the recorded administration state
// and the outstanding reservations. Approved-unexpired reservations are effective and
// pending requests do not reserve; neither is ever reassigned by deactivation, so release or
// expiry stays with its existing claimant, reviewer and expiry rules.
export async function loadDeactivationConfirmation(
  context: RouteContext,
  employeeId: string,
): Promise<DeactivationConfirmation> {
  const target = await employeeTarget(context, employeeId);
  const [operations, reservations] = await Promise.all([
    context.client
      .from('employee_admin_operations')
      .select(
        'id,employee_id,actor_id,kind,state,revision,provider_outcome,provider_detail,provider_ban_until,membership_disabled_at,completed_at',
      )
      .eq('employee_id', employeeId)
      .eq('kind', 'deactivate')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1),
    outstandingReservationsFor(context, employeeId),
  ]);
  if (operations.error) throw databaseError(operations.error);
  const latest = operations.data?.[0] as Record<string, unknown> | undefined;
  return {
    employee: {
      id: target.id,
      displayName: target.display_name,
      email: target.email,
      role: target.role,
      access: accessState(target),
    },
    operation: latest ? operationFromRow(latest) : null,
    reservations,
  };
}

// The guarded action: disable membership first, then have the server-only adapter attempt the
// exact sign-in block and record the outcome. A provider failure stays recorded as a
// reconciliation state; a missing server secret fails closed with the operation left open
// rather than claiming anything about authentication.
export async function administerEmployeeDeactivation(
  context: RouteContext,
  actor: Employee,
  employeeId: string,
  key: string,
): Promise<DeactivationConfirmation> {
  const target = await employeeTarget(context, employeeId);
  const admin = createEmployeeAdminClient(context.environment);
  const gateway = databaseGateway(context, admin);
  if (!admin) {
    await gateway.begin(employeeId, key);
    throw new ApiError(503, 'provider-unavailable');
  }
  await administerDeactivation(gateway, supabaseSignInBlocker(admin), {
    employeeId,
    authUserId: target.auth_user_id ?? '',
    actorId: actor.id,
    key,
  });
  // Re-read live membership after the provider transition: an admin who deactivated their own
  // row gets the normal denial path instead of a 404 for the now-hidden employee row.
  await activeEmployee(context);
  return loadDeactivationConfirmation(context, employeeId);
}
