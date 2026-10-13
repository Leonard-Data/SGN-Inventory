// Issue #66: the employee-administration interface for deactivation without losing the
// record. Membership is disabled first; only a confirmed provider result completes the
// action, and an unconfirmed outcome stays a truthful reconciliation state. This module is
// pure so the guarded route and the fault-injection tests share exactly one interface;
// nothing here transfers a reservation or rewrites attribution.

export type DeactivationState =
  'provider_pending' | 'provider_failed' | 'completed';

export type ProviderOutcome = 'blocked' | 'failed' | 'ambiguous';

export type DeactivationOperation = {
  id: string;
  employeeId: string;
  actorId: string;
  kind: 'deactivate';
  state: DeactivationState;
  revision: number;
  providerOutcome: ProviderOutcome | null;
  providerDetail: string | null;
  providerBanUntil: string | null;
  membershipDisabledAt: string;
  completedAt: string | null;
};

export type OutstandingReservation = {
  id: string;
  propertyId: string;
  propertyCode: string;
  kind: 'effective' | 'pending';
  expiresAt: string;
};

export type DeactivationEmployee = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  access: 'active' | 'inactive' | 'unlinked';
};

export type DeactivationConfirmation = {
  employee: DeactivationEmployee;
  operation: DeactivationOperation | null;
  reservations: OutstandingReservation[];
};

// The provider boundary. A blocked result must carry the provider's own reference and a
// finite ban expiry; anything else is failed or ambiguous and never completes an action.
export type ProviderBanRequest = {
  employeeId: string;
  authUserId: string;
};

export type ProviderBanResult =
  | { outcome: 'blocked'; reference: string; banUntil: string }
  | { outcome: 'failed'; detail: string }
  | { outcome: 'ambiguous'; detail: string };

export interface SignInBlocker {
  block(request: ProviderBanRequest): Promise<ProviderBanResult>;
}

export type DeactivationRecordRequest = {
  operationId: string;
  revision: number;
  actorId: string;
  authUserId: string;
  result: ProviderBanResult;
};

// The database gateway. Begin converges on the original action for the same actor/key and
// resumes an open action for any live admin; record advances exactly one revision.
export interface DeactivationGateway {
  begin(employeeId: string, key: string): Promise<DeactivationOperation>;
  record(request: DeactivationRecordRequest): Promise<DeactivationOperation>;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

// Admin surface rule, named once so the list route, the deactivation route and the tests
// agree. It is always re-read from live membership, never from the browser.
export function mayAdministerEmployees(role: string): boolean {
  return role === 'admin';
}

// Exactly `{key: UUID}`; no employee, actor, outcome or revision is accepted from the
// caller. The key is the client's retry identity for one confirmed action.
export function deactivationKey(body: Record<string, unknown>): string | null {
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'key') return null;
  return isUuid(body.key) ? body.key : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null;
}

function instantOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    return null;
  return value;
}

// The RPC projection is revalidated at the boundary: a missing or malformed operation is
// never rendered as a success or as a safe reconciliation state.
export function parseDeactivationOperation(
  value: unknown,
): DeactivationOperation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    !isUuid(row.id) ||
    !isUuid(row.employeeId) ||
    !isUuid(row.actorId) ||
    row.kind !== 'deactivate' ||
    !['provider_pending', 'provider_failed', 'completed'].includes(
      row.state as string,
    ) ||
    typeof row.revision !== 'number' ||
    !Number.isInteger(row.revision) ||
    row.revision < 1 ||
    (row.providerOutcome !== null &&
      !['blocked', 'failed', 'ambiguous'].includes(
        row.providerOutcome as string,
      ))
  )
    return null;
  const membershipDisabledAt = instantOrNull(row.membershipDisabledAt);
  const completedAt = instantOrNull(row.completedAt);
  if (!membershipDisabledAt) return null;
  const state = row.state as DeactivationState;
  if ((state === 'completed') !== (completedAt !== null)) return null;
  return {
    id: row.id,
    employeeId: row.employeeId,
    actorId: row.actorId,
    kind: 'deactivate',
    state,
    revision: row.revision,
    providerOutcome: (row.providerOutcome as ProviderOutcome | null) ?? null,
    providerDetail: textOrNull(row.providerDetail),
    providerBanUntil: instantOrNull(row.providerBanUntil),
    membershipDisabledAt,
    completedAt,
  };
}

export type ReservationLockRow = {
  id: string;
  property_id: string;
  status: string;
  expires_at: string | null;
  properties?: { property_code?: string | null } | null;
};

// The control makes outstanding reservations visible; release or expiry stays explicit with
// the existing claimant, reviewer and expiry rules. Nothing here reassigns a reservation.
export function outstandingReservations(
  rows: readonly ReservationLockRow[],
  now: Date,
): OutstandingReservation[] {
  return rows
    .filter(
      (row) =>
        (row.status === 'pending' || row.status === 'approved') &&
        !!row.expires_at &&
        Date.parse(row.expires_at) > now.getTime(),
    )
    .map((row) => ({
      id: row.id,
      propertyId: row.property_id,
      propertyCode: row.properties?.property_code ?? '',
      kind:
        row.status === 'approved'
          ? ('effective' as const)
          : ('pending' as const),
      expiresAt: row.expires_at!,
    }))
    .sort(
      (left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt),
    );
}

// A failed or ambiguous provider attempt is recorded, never thrown away: the membership
// stays disabled, the action stays resumable and no success is claimed.
export async function administerDeactivation(
  gateway: DeactivationGateway,
  blocker: SignInBlocker,
  input: {
    employeeId: string;
    authUserId: string;
    actorId: string;
    key: string;
  },
): Promise<DeactivationOperation> {
  const operation = await gateway.begin(input.employeeId, input.key);
  if (operation.state === 'completed') return operation;
  const result = await attemptSignInBlock(blocker, {
    employeeId: operation.employeeId,
    authUserId: input.authUserId,
  });
  return gateway.record({
    operationId: operation.id,
    revision: operation.revision,
    actorId: input.actorId,
    authUserId: input.authUserId,
    result,
  });
}

// The blocker is the only path that may claim a provider block. An unexpected failure is a
// failed reconciliation, not a completed deactivation.
export async function attemptSignInBlock(
  blocker: SignInBlocker,
  request: ProviderBanRequest,
): Promise<ProviderBanResult> {
  try {
    return await blocker.block(request);
  } catch (failure) {
    return { outcome: 'failed', detail: providerDetail(failure) };
  }
}

// Bounded and redacted so a transport or configuration message is useful evidence without
// ever carrying a provider key or an unbounded remote payload into the database or the UI.
export function providerDetail(failure: unknown): string {
  const raw = failure instanceof Error ? failure.message : '';
  const cleaned = raw
    .replace(
      /(?:eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}|sb_(?:secret|publishable)_[A-Za-z0-9_-]+)/g,
      '[redacted]',
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'provider request did not complete';
  return cleaned.length > 500 ? cleaned.slice(0, 500) : cleaned;
}

export type ProviderAdminResponse = {
  user: { id?: unknown; banned_until?: unknown } | null;
  error: { status?: number; message?: string } | null;
};

// The provider's own response is the only evidence of a block: the confirmed identity and a
// finite ban expiry must both be present. A 4xx is a failed attempt, a 5xx or absent status
// an ambiguous one; neither may be rendered as completed deactivation.
export function providerBanResult(
  response: ProviderAdminResponse,
): ProviderBanResult {
  if (response.error) {
    const status =
      typeof response.error.status === 'number' ? response.error.status : 0;
    return {
      outcome: status >= 400 && status < 500 ? 'failed' : 'ambiguous',
      detail: providerDetail(new Error(response.error.message ?? '')),
    };
  }
  const id = typeof response.user?.id === 'string' ? response.user.id : '';
  const bannedUntil =
    typeof response.user?.banned_until === 'string' &&
    Number.isFinite(Date.parse(response.user.banned_until))
      ? response.user.banned_until
      : null;
  if (!id || !bannedUntil)
    return {
      outcome: 'ambiguous',
      detail: 'provider accepted the request without a confirmed ban expiry',
    };
  return { outcome: 'blocked', reference: id, banUntil: bannedUntil };
}

// Server-only provider configuration. The public/publishable key must never be used for an
// Auth admin call, and a missing or placeholder secret fails closed as a failed attempt.
export function providerServiceKey(
  values: Readonly<Record<string, string | undefined>>,
): string | null {
  const value = values.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!value || /YOUR_|REPLACE_|CHANGE_ME/.test(value)) return null;
  if (value.startsWith('sb_secret_')) return value;
  if (value.startsWith('sb_publishable_')) return null;
  const parts = value.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { role?: unknown };
    return payload.role === 'service_role' ? value : null;
  } catch {
    return null;
  }
}

// GoTrue accepts a bounded duration string; the confirmed ban expiry comes back from the
// provider and is stored per operation. The block is finite and is renewed only by an
// explicit retry, never described as an infinite or identity-deleting state.
export const SIGN_IN_BLOCK_BAN_DURATION = '876000h';

// The one status the list and the confirmation render. A pending or failed provider step is
// a reconciliation state, never displayed as completed deactivation.
export function deactivationStatus(
  operation: DeactivationOperation | null,
): 'none' | 'pending' | 'reconciliation' | 'confirmed' {
  if (!operation) return 'none';
  if (operation.state === 'completed') return 'confirmed';
  return operation.state === 'provider_pending' ? 'pending' : 'reconciliation';
}
