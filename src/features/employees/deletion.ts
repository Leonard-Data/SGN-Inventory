// Issue #67: the employee-administration interface for permanently deleting a sign-in
// account while retaining the employee. Membership is disabled and the sign-in link cleared
// before any provider call; Storage ownership is then preflighted and reassigned to an
// authorized retained custodian where required; only a confirmed absent provider account
// completes the action. Anything else stays a truthful, resumable partial state, and no
// outcome ever deletes, retargets or anonymizes a business record as compensation.
//
// This module is pure so the guarded route and the fault-injection tests share exactly one
// interface.

import {
  isUuid,
  mayAdministerEmployees,
  providerDetail,
  type DeactivationState,
  type OutstandingReservation,
  deactivationKey,
} from './deactivation.ts';

export type DeletionOutcome =
  'deleted' | 'storage_blocked' | 'failed' | 'ambiguous';

export type DeletionOperation = {
  id: string;
  employeeId: string;
  actorId: string;
  kind: 'delete';
  state: DeactivationState;
  revision: number;
  providerOutcome: DeletionOutcome | null;
  providerDetail: string | null;
  // The exact Auth identity this action is locked to. It is recorded on the operation before
  // the unlink, so resuming and retained attribution never need a living Auth row; the
  // database requires it for every deletion operation.
  targetAuthUserId: string;
  storageOwnedCount: number | null;
  storageReassignedCount: number | null;
  membershipDisabledAt: string;
  completedAt: string | null;
};

export type DeletionEmployee = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  access: 'active' | 'inactive' | 'unlinked' | 'account_deleted';
};

export type DeletionConfirmation = {
  employee: DeletionEmployee;
  operation: DeletionOperation | null;
  reservations: OutstandingReservation[];
};

// The Storage ownership preflight. `supported` is false when the Storage schema is not the
// shape this adapter was verified against; the caller then records a truthful partial state
// instead of guessing.
export type StoragePreflight = {
  supported: boolean;
  ownedCount: number;
};

export type StorageReassignment = {
  supported: boolean;
  reassignedCount: number;
};

// The provider deletion boundary. Only a provider-confirmed absent account may complete.
export type AccountDeletionResult =
  | { outcome: 'deleted'; reference: string }
  | { outcome: 'failed'; detail: string }
  | { outcome: 'ambiguous'; detail: string };

export type AccountPresence = 'present' | 'absent' | 'unknown';

export interface AccountDeletionProvider {
  preflight(authUserId: string): Promise<StoragePreflight>;
  reassignStorageOwnership(
    fromAuthUserId: string,
    toAuthUserId: string,
  ): Promise<StorageReassignment>;
  deleteAccount(authUserId: string): Promise<AccountDeletionResult>;
  accountPresence(authUserId: string): Promise<AccountPresence>;
}

// The Storage ownership outcome. `blocked` is a truthful partial state: owned objects that
// could not be safely reassigned are reported, never deleted or retargeted.
export type StorageCustody = {
  blocked: boolean;
  ownedCount: number | null;
  reassignedCount: number | null;
  detail: string | null;
};

export type DeletionRecordRequest = {
  operationId: string;
  revision: number;
  actorId: string;
  authUserId: string;
  result:
    AccountDeletionResult | { outcome: 'storage_blocked'; detail: string };
  storageOwned: number | null;
  storageReassigned: number | null;
};

export interface AccountDeletionGateway {
  begin(employeeId: string, key: string): Promise<DeletionOperation>;
  record(request: DeletionRecordRequest): Promise<DeletionOperation>;
}

// The submission body is exactly `{key: UUID}` for both lifecycle actions: the browser never
// supplies the actor, the target identity, an outcome or a revision.
export const deletionKey = deactivationKey;

export { mayAdministerEmployees };

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null;
}

function instantOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    return null;
  return value;
}

function countOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

// A present but impossible count is a malformed projection, not a missing one.
function validCount(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'number' && Number.isInteger(value) && value >= 0)
  );
}

const deletionOutcomes: readonly DeletionOutcome[] = [
  'deleted',
  'storage_blocked',
  'failed',
  'ambiguous',
];

// The RPC projection is revalidated at the boundary: a malformed operation is never rendered
// as a completed deletion or as a safe partial state.
export function parseDeletionOperation(
  value: unknown,
): DeletionOperation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    !isUuid(row.id) ||
    !isUuid(row.employeeId) ||
    !isUuid(row.actorId) ||
    row.kind !== 'delete' ||
    !['provider_pending', 'provider_failed', 'completed'].includes(
      row.state as string,
    ) ||
    typeof row.revision !== 'number' ||
    !Number.isInteger(row.revision) ||
    row.revision < 1 ||
    (row.providerOutcome !== null &&
      !deletionOutcomes.includes(row.providerOutcome as DeletionOutcome)) ||
    !validCount(row.storageOwnedCount) ||
    !validCount(row.storageReassignedCount)
  )
    return null;
  const membershipDisabledAt = instantOrNull(row.membershipDisabledAt);
  const completedAt = instantOrNull(row.completedAt);
  if (!membershipDisabledAt) return null;
  const state = row.state as DeactivationState;
  if ((state === 'completed') !== (completedAt !== null)) return null;
  const targetAuthUserId = textOrNull(row.targetAuthUserId);
  if (!isUuid(targetAuthUserId)) return null;
  return {
    id: row.id,
    employeeId: row.employeeId,
    actorId: row.actorId,
    kind: 'delete',
    state,
    revision: row.revision,
    providerOutcome: (row.providerOutcome as DeletionOutcome | null) ?? null,
    providerDetail: textOrNull(row.providerDetail),
    targetAuthUserId,
    storageOwnedCount: countOrNull(row.storageOwnedCount),
    storageReassignedCount: countOrNull(row.storageReassignedCount),
    membershipDisabledAt,
    completedAt,
  };
}

// Provider payloads are revalidated rather than trusted: an unexpected shape fails closed as
// an unavailable step instead of being read as a supported, empty preflight.
export function parseStoragePreflight(value: unknown): StoragePreflight | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const ownedCount = countOrNull(row.ownedCount);
  if (typeof row.supported !== 'boolean' || ownedCount === null) return null;
  return { supported: row.supported, ownedCount };
}

export function parseStorageReassignment(
  value: unknown,
): StorageReassignment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const reassignedCount = countOrNull(row.reassignedCount);
  if (typeof row.supported !== 'boolean' || reassignedCount === null)
    return null;
  return { supported: row.supported, reassignedCount };
}

// The one status the list and the confirmation render. A pending, blocked or failed provider
// step is a reconciliation state, never displayed as a completed account deletion.
export function deletionStatus(
  operation: DeletionOperation | null,
): 'none' | 'pending' | 'reconciliation' | 'storage-blocked' | 'confirmed' {
  if (!operation) return 'none';
  if (operation.state === 'completed') return 'confirmed';
  if (operation.state === 'provider_pending') return 'pending';
  return operation.providerOutcome === 'storage_blocked'
    ? 'storage-blocked'
    : 'reconciliation';
}

// A successful deletion is only claimed when the provider account is confirmed absent, so a
// response accepted without an absence confirmation is ambiguous, not completed.
export function accountDeletionResult(response: {
  user: { id?: unknown } | null;
  error: { status?: number; message?: string } | null;
}): AccountDeletionResult {
  if (response.error) {
    const status =
      typeof response.error.status === 'number' ? response.error.status : 0;
    return {
      outcome: status >= 400 && status < 500 ? 'failed' : 'ambiguous',
      detail: providerDetail(new Error(response.error.message ?? '')),
    };
  }
  const id = typeof response.user?.id === 'string' ? response.user.id : '';
  if (!id)
    return {
      outcome: 'ambiguous',
      detail: 'provider accepted the deletion without returning the account',
    };
  return { outcome: 'deleted', reference: id };
}

// A presenceread decides convergence: an already-absent account is a completed deletion even
// when the earlier acknowledgment was lost, and an unreadable answer never counts as absent.
export function accountPresence(response: {
  user: { id?: unknown } | null;
  error: { status?: number } | null;
}): AccountPresence {
  if (response.error)
    return typeof response.error.status === 'number' &&
      response.error.status === 404
      ? 'absent'
      : 'unknown';
  return response.user ? 'present' : 'absent';
}

// Pending or failed provider steps can be resumed by a currently authorized admin: only a
// recorded completed deletion is terminal, whether the caller holds the full operation or
// the list projection.
export function deletionResumable(
  operation: Pick<DeletionOperation, 'state'> | null,
): boolean {
  return operation !== null && operation.state !== 'completed';
}

// Preflight, then reassign only what is owned. A preflight or reassignment that cannot be
// verified leaves a truthful partial state; no document is ever deleted to make progress.
export async function reassignOwnedStorage(
  provider: AccountDeletionProvider,
  authUserId: string,
  custodianAuthUserId: string,
): Promise<StorageCustody> {
  let preflight: StoragePreflight;
  try {
    preflight = await provider.preflight(authUserId);
  } catch (failure) {
    return {
      blocked: true,
      ownedCount: null,
      reassignedCount: null,
      detail: providerDetail(failure),
    };
  }
  if (!preflight.supported)
    return {
      blocked: true,
      ownedCount: null,
      reassignedCount: null,
      detail: 'storage ownership preflight unavailable',
    };
  if (preflight.ownedCount === 0)
    return { blocked: false, ownedCount: 0, reassignedCount: 0, detail: null };
  let moved: StorageReassignment;
  try {
    moved = await provider.reassignStorageOwnership(
      authUserId,
      custodianAuthUserId,
    );
  } catch (failure) {
    return {
      blocked: true,
      ownedCount: preflight.ownedCount,
      reassignedCount: null,
      detail: providerDetail(failure),
    };
  }
  if (!moved.supported)
    return {
      blocked: true,
      ownedCount: preflight.ownedCount,
      reassignedCount: 0,
      detail: 'storage ownership reassignment unavailable',
    };
  let after: StoragePreflight;
  try {
    after = await provider.preflight(authUserId);
  } catch (failure) {
    return {
      blocked: true,
      ownedCount: preflight.ownedCount,
      reassignedCount: moved.reassignedCount,
      detail: providerDetail(failure),
    };
  }
  if (!after.supported || after.ownedCount > 0)
    return {
      blocked: true,
      ownedCount: preflight.ownedCount,
      reassignedCount: moved.reassignedCount,
      detail: 'storage objects remain owned after reassignment',
    };
  return {
    blocked: false,
    ownedCount: preflight.ownedCount,
    reassignedCount: moved.reassignedCount,
    detail: null,
  };
}

// A resume that finds nothing left to move keeps the counts its earlier attempt recorded: once
// an earlier attempt already reassigned the objects, the fresh preflight reports zero, and the
// completed deletion must not then report that it owned none.
function recordedCustody(
  operation: DeletionOperation,
  custody: StorageCustody,
): StorageCustody {
  if (custody.ownedCount !== 0 || operation.storageOwnedCount === null)
    return custody;
  return {
    ...custody,
    ownedCount: operation.storageOwnedCount,
    reassignedCount:
      operation.storageReassignedCount ?? custody.reassignedCount,
  };
}

// The deleter is the only path that may claim a provider deletion. An unexpected failure is a
// truthful partial state, never a completed deletion.
export async function attemptAccountDeletion(
  provider: AccountDeletionProvider,
  authUserId: string,
): Promise<AccountDeletionResult> {
  try {
    return await provider.deleteAccount(authUserId);
  } catch (failure) {
    return { outcome: 'ambiguous', detail: providerDetail(failure) };
  }
}

// The orchestration: converge on the recorded action, reassign owned Storage, then confirm
// the absent account before recording completion. A lost acknowledgment, a duplicate attempt
// or an already-deleted account all resolve to the same operation.
export async function administerAccountDeletion(
  gateway: AccountDeletionGateway,
  provider: AccountDeletionProvider,
  input: {
    employeeId: string;
    custodianAuthUserId: string;
    actorId: string;
    key: string;
  },
): Promise<DeletionOperation> {
  const operation = await gateway.begin(input.employeeId, input.key);
  if (operation.state === 'completed') return operation;
  // The operation's recorded identity is authoritative after the unlink.
  const authUserId = operation.targetAuthUserId;
  const custody = recordedCustody(
    operation,
    await reassignOwnedStorage(provider, authUserId, input.custodianAuthUserId),
  );
  if (custody.blocked)
    return gateway.record({
      operationId: operation.id,
      revision: operation.revision,
      actorId: input.actorId,
      authUserId,
      result: {
        outcome: 'storage_blocked',
        detail: custody.detail ?? 'storage ownership unavailable',
      },
      storageOwned: custody.ownedCount,
      storageReassigned: custody.reassignedCount,
    });
  let presence: AccountPresence;
  try {
    presence = await provider.accountPresence(authUserId);
  } catch {
    presence = 'unknown';
  }
  if (presence === 'absent')
    return gateway.record({
      operationId: operation.id,
      revision: operation.revision,
      actorId: input.actorId,
      authUserId,
      result: { outcome: 'deleted', reference: authUserId },
      storageOwned: custody.ownedCount,
      storageReassigned: custody.reassignedCount,
    });
  const attempt = await attemptAccountDeletion(provider, authUserId);
  if (attempt.outcome === 'deleted') {
    let confirmed: AccountPresence;
    try {
      confirmed = await provider.accountPresence(authUserId);
    } catch {
      confirmed = 'unknown';
    }
    if (confirmed !== 'absent')
      return gateway.record({
        operationId: operation.id,
        revision: operation.revision,
        actorId: input.actorId,
        authUserId,
        result: {
          outcome: 'ambiguous',
          detail: 'provider deletion was not confirmed by an absent account',
        },
        storageOwned: custody.ownedCount,
        storageReassigned: custody.reassignedCount,
      });
  }
  if (attempt.outcome !== 'deleted') {
    // A definite refusal may still follow a deletion that another attempt already committed,
    // so the recorded account presence decides instead of the response alone.
    let confirmed: AccountPresence;
    try {
      confirmed = await provider.accountPresence(authUserId);
    } catch {
      confirmed = 'unknown';
    }
    if (confirmed === 'absent')
      return gateway.record({
        operationId: operation.id,
        revision: operation.revision,
        actorId: input.actorId,
        authUserId,
        result: { outcome: 'deleted', reference: authUserId },
        storageOwned: custody.ownedCount,
        storageReassigned: custody.reassignedCount,
      });
  }
  return gateway.record({
    operationId: operation.id,
    revision: operation.revision,
    actorId: input.actorId,
    authUserId,
    result: attempt,
    storageOwned: custody.ownedCount,
    storageReassigned: custody.reassignedCount,
  });
}
