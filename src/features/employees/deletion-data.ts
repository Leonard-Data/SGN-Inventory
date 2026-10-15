import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import type { Database } from '@/types/database';
import type { Employee } from './types';
import { activeEmployee } from './access';
import { accessState } from './directory';
import { outstandingReservationsFor } from './deactivation-data';
import {
  administerAccountDeletion,
  isUuid,
  parseDeletionOperation,
  type AccountDeletionGateway,
  type DeletionConfirmation,
  type DeletionOperation,
} from './deletion';
import { createEmployeeAdminClient } from './provider-ban';
import { supabaseAccountDeletionProvider } from './provider-deletion';

// Issue #67: the session-scoped read and the guarded permanent-deletion call. Membership is
// disabled and the sign-in link cleared through the guarded begin RPC with the caller's
// publishable-key client; the server-only secret client is used for nothing except the exact
// employee's Auth account, its Storage ownership preflight/reassignment and recording the
// confirmed outcome, so no browser can claim a deleted account or move Storage ownership.
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

// Each distinct business refusal has its own code so the route answers an actionable message
// instead of one generic failure.
function workflowError(error: { code?: string }): ApiError {
  if (error.code === '42501') return new ApiError(403, 'access-denied');
  if (error.code === '23505') return new ApiError(409, 'deletion-key-conflict');
  if (error.code === '23514') return new ApiError(400, 'invalid-input');
  if (error.code === 'P0010') return new ApiError(409, 'last-admin');
  if (error.code === 'P0011') return new ApiError(409, 'not-deletable');
  // A competing deactivation or deletion is open on the same employee.
  if (error.code === 'P0013') return new ApiError(409, 'lifecycle-conflict');
  if (error.code === 'P0012') return new ApiError(409, 'stale-operation');
  if (error.code === 'PT409') return new ApiError(409, 'stale-operation');
  return new ApiError(503, 'unavailable');
}

function operationFromRow(
  row: Record<string, unknown>,
): DeletionOperation | null {
  return parseDeletionOperation({
    id: row.id,
    employeeId: row.employee_id,
    actorId: row.actor_id,
    kind: row.kind,
    state: row.state,
    revision: row.revision,
    providerOutcome: row.provider_outcome,
    providerDetail: row.provider_detail,
    targetAuthUserId: row.target_auth_user_id,
    storageOwnedCount: row.storage_owned_count,
    storageReassignedCount: row.storage_reassigned_count,
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

// The live session's own Auth identity is the Storage ownership custodian: it is an author-
// ized retained identity by construction, and the guarded reassignment re-checks that it is a
// live active admin. It is never accepted from the browser.
async function sessionAuthUserId(context: RouteContext): Promise<string> {
  const {
    data: { user },
    error,
  } = await context.client.auth.getUser();
  if (
    error &&
    (error.name === 'AuthRetryableFetchError' || (error.status ?? 0) >= 500)
  )
    throw new ApiError(503, 'unavailable');
  if (!user) throw new ApiError(401, 'unauthenticated');
  return user.id;
}

// The gateway talks to the guarded RPCs only. `begin` uses the caller's session, so the
// live-admin check, the last-active-admin guard and the unlink execute in the database.
// `record` and the two Storage steps are server-only because provider acceptance and Storage
// ownership must never be claimable from a browser.
function databaseGateway(
  context: RouteContext,
  admin: SupabaseClient<Database> | null,
): AccountDeletionGateway {
  return {
    async begin(employeeId, key) {
      const { data, error } = await context.client.rpc(
        'begin_employee_account_deletion',
        { p_employee_id: employeeId, p_key: key },
      );
      if (error) throw workflowError(error);
      const operation = parseDeletionOperation(data);
      if (!operation) throw new ApiError(503, 'unavailable');
      return operation;
    },
    async record(request) {
      if (!admin) throw new ApiError(503, 'provider-unavailable');
      const { data, error } = await admin.rpc(
        'record_employee_account_deletion_result',
        {
          p_operation_id: request.operationId,
          p_revision: request.revision,
          p_actor_id: request.actorId,
          p_auth_user_id: request.authUserId,
          p_outcome: request.result.outcome,
          p_provider_reference:
            request.result.outcome === 'deleted'
              ? request.result.reference
              : null,
          p_storage_owned: request.storageOwned,
          p_storage_reassigned: request.storageReassigned,
          p_detail:
            request.result.outcome === 'deleted' ? null : request.result.detail,
        },
      );
      if (error) throw workflowError(error);
      const operation = parseDeletionOperation(data);
      if (!operation) throw new ApiError(503, 'unavailable');
      return operation;
    },
  };
}

// The confirmation the admin list opens: the exact retained employee, the recorded deletion
// state and the outstanding reservations that access removal must not rewrite.
export async function loadDeletionConfirmation(
  context: RouteContext,
  employeeId: string,
): Promise<DeletionConfirmation> {
  const target = await employeeTarget(context, employeeId);
  const [operations, reservations] = await Promise.all([
    context.client
      .from('employee_admin_operations')
      .select(
        'id,employee_id,actor_id,kind,state,revision,provider_outcome,provider_detail,target_auth_user_id,storage_owned_count,storage_reassigned_count,membership_disabled_at,completed_at',
      )
      .eq('employee_id', employeeId)
      .eq('kind', 'delete')
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

// The guarded action: disable membership and clear the sign-in link first, then let the
// server-only adapter preflight and reassign Storage ownership, delete the exact Auth account
// and confirm it is absent. A Storage or provider failure stays recorded as a reconciliation
// state; a missing server secret fails closed with the operation left open rather than
// claiming anything about the account.
export async function administerEmployeeAccountDeletion(
  context: RouteContext,
  actor: Employee,
  employeeId: string,
  key: string,
): Promise<DeletionConfirmation> {
  await employeeTarget(context, employeeId);
  const custodianAuthUserId = await sessionAuthUserId(context);
  const admin = createEmployeeAdminClient(context.environment);
  const gateway = databaseGateway(context, admin);
  if (!admin) {
    await gateway.begin(employeeId, key);
    throw new ApiError(503, 'provider-unavailable');
  }
  await administerAccountDeletion(
    gateway,
    supabaseAccountDeletionProvider(admin),
    {
      employeeId,
      custodianAuthUserId,
      actorId: actor.id,
      key,
    },
  );
  // Re-read live membership after the provider transition: an admin who deleted their own
  // account gets the normal denial path instead of a 404 for the now-unlinked row.
  await activeEmployee(context);
  return loadDeletionConfirmation(context, employeeId);
}
