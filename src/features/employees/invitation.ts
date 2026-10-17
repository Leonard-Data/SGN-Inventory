// Issue #68: the recorded role-bound employee invitation. One live admin chooses a validated
// normalized email and one existing company role; the invitation keeps that role and the
// acting admin, and the provider request is recorded truthfully — an accepted request is
// never presented as proof that a mailbox received the message and never activates the
// invited person. This module is pure so the guarded route, the admin form and the tests
// share exactly one interface.

import {
  deactivationFailure,
  deactivationProblemAfterLoad,
  isUuid,
  mayAdministerEmployees,
  providerDetail,
} from './deactivation.ts';

export { isUuid, mayAdministerEmployees };

export const EMPLOYEE_ROLES = ['sales', 'staff', 'manager', 'admin'] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export function isEmployeeRole(value: unknown): value is EmployeeRole {
  return (
    typeof value === 'string' &&
    (EMPLOYEE_ROLES as readonly string[]).includes(value)
  );
}

export type InvitationState =
  'provider_pending' | 'provider_failed' | 'recorded';

export type InvitationOutcome = 'accepted' | 'failed' | 'ambiguous';

// The guarded RPC projection. The provider sign-in identity is deliberately absent: the admin
// reconciles the recorded state and no public response carries it.
export type EmployeeInvitation = {
  id: string;
  employeeId: string;
  actorId: string;
  email: string;
  role: EmployeeRole;
  state: InvitationState;
  revision: number;
  providerOutcome: InvitationOutcome | null;
  providerDetail: string | null;
  providerAttemptedAt: string | null;
  requestedAt: string;
  recordedAt: string | null;
};

export type InvitedEmployee = {
  id: string;
  displayName: string;
  email: string;
  role: string;
};

// The recorded invitation for one intended person, or an employee with no invitation yet.
export type InvitationRecord = {
  employee: InvitedEmployee | null;
  invitation: EmployeeInvitation | null;
};

export type InvitationRequest = {
  email: string;
  role: EmployeeRole;
  key: string;
};

export class InvitationError extends Error {
  readonly code = 'invalid-input' as const;

  constructor() {
    super('invalid-input');
  }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// One normalized address is the intended identity for the whole invitation: trimming and
// lower-casing happen once here, the database stores exactly this form, and the provider
// response is matched against the recorded address rather than a retyped one.
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !emailPattern.test(email)) return null;
  return email;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null;
}

function instantOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    return null;
  return value;
}

// Exactly `{email, role, key}`: the acting admin, the invited employee and any provider
// outcome come from the session and the server adapter, never from the browser.
export function invitationBody(
  body: Record<string, unknown>,
): InvitationRequest | null {
  const keys = Object.keys(body);
  if (
    keys.length !== 3 ||
    !keys.includes('email') ||
    !keys.includes('role') ||
    !keys.includes('key')
  )
    return null;
  const email = normalizeEmail(body.email);
  if (!email || !isEmployeeRole(body.role) || !isUuid(body.key)) return null;
  return { email, role: body.role, key: body.key };
}

// The reconciliation read accepts one normalized address and nothing else, so a lost response
// is reconciled against the same intended identity as the original submission.
export function invitationQuery(params: URLSearchParams): string {
  const email = normalizeEmail(params.get('email'));
  if (
    !email ||
    params.getAll('email').length !== 1 ||
    [...params.keys()].some((key) => key !== 'email')
  )
    throw new InvitationError();
  return email;
}

// The RPC projection is revalidated at the boundary with the same rules the table enforces, so
// a malformed row is never rendered as a recorded invitation or as a safe reconciliation
// state.
export function parseInvitation(value: unknown): EmployeeInvitation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isUuid(row.id) || !isUuid(row.employeeId) || !isUuid(row.actorId))
    return null;
  const email = normalizeEmail(row.email);
  if (!email || !isEmployeeRole(row.role)) return null;
  if (
    !['provider_pending', 'provider_failed', 'recorded'].includes(
      row.state as string,
    ) ||
    typeof row.revision !== 'number' ||
    !Number.isInteger(row.revision) ||
    row.revision < 1 ||
    (row.providerOutcome !== null &&
      !['accepted', 'failed', 'ambiguous'].includes(
        row.providerOutcome as string,
      ))
  )
    return null;
  const requestedAt = instantOrNull(row.requestedAt);
  if (!requestedAt) return null;
  const state = row.state as InvitationState;
  const outcome = (row.providerOutcome as InvitationOutcome | null) ?? null;
  const recordedAt = instantOrNull(row.recordedAt);
  if ((state === 'recorded') !== (recordedAt !== null)) return null;
  if (state === 'recorded' && outcome !== 'accepted') return null;
  if (state === 'provider_pending' && outcome !== null) return null;
  if (
    state === 'provider_failed' &&
    outcome !== 'failed' &&
    outcome !== 'ambiguous'
  )
    return null;
  return {
    id: row.id,
    employeeId: row.employeeId,
    actorId: row.actorId,
    email,
    role: row.role,
    state,
    revision: row.revision,
    providerOutcome: outcome,
    providerDetail: textOrNull(row.providerDetail),
    providerAttemptedAt: instantOrNull(row.providerAttemptedAt),
    requestedAt,
    recordedAt,
  };
}

// The `employee_invitations` row projection: the database read returns snake_case, so it is
// mapped here once and every read path shares the same boundary rules.
export function invitationFromRow(
  row: Record<string, unknown>,
): EmployeeInvitation | null {
  return parseInvitation({
    id: row.id,
    employeeId: row.employee_id,
    actorId: row.actor_id,
    email: row.email,
    role: row.role,
    state: row.state,
    revision: row.revision,
    providerOutcome: row.provider_outcome,
    providerDetail: row.provider_detail,
    providerAttemptedAt: row.provider_attempted_at,
    requestedAt: row.requested_at,
    recordedAt: row.recorded_at,
  });
}

// The one status the list and the form render. `recorded` means the provider accepted the
// invitation request; a pending or failed provider step is a reconciliation state and is
// never displayed as a delivered or accepted invitation.
export function invitationStatus(
  invitation: EmployeeInvitation | null,
): 'none' | 'pending' | 'reconciliation' | 'recorded' {
  if (!invitation) return 'none';
  if (invitation.state === 'recorded') return 'recorded';
  return invitation.state === 'provider_pending' ? 'pending' : 'reconciliation';
}

export type ProviderInviteResponse = {
  user: { id?: unknown; email?: unknown } | null;
  error: { status?: number; message?: string } | null;
};

export type InvitationProviderResult =
  | { outcome: 'accepted'; providerUserId: string }
  | { outcome: 'failed'; detail: string }
  | { outcome: 'ambiguous'; detail: string };

// The provider's own response is the only evidence of an accepted request and it must name the
// exact recorded address. A missing identity, a malformed one or a different address is
// ambiguous, never an accepted invitation, and nothing here claims the mailbox received the
// message. A 4xx is a definite refusal; a 5xx or absent status may have been accepted.
export function providerInviteResult(
  response: ProviderInviteResponse,
  email: string,
): InvitationProviderResult {
  if (response.error) {
    const status =
      typeof response.error.status === 'number' ? response.error.status : 0;
    return {
      outcome: status >= 400 && status < 500 ? 'failed' : 'ambiguous',
      detail: providerDetail(new Error(response.error.message ?? '')),
    };
  }
  const id = typeof response.user?.id === 'string' ? response.user.id : '';
  const received = normalizeEmail(response.user?.email);
  if (!isUuid(id) || !received || received !== email)
    return {
      outcome: 'ambiguous',
      detail:
        'the provider accepted the request without confirming the intended identity',
    };
  return { outcome: 'accepted', providerUserId: id };
}

// The fixed application destination for an invitation email. It is built from the configured
// application origin and a constant path, so no request can redirect it; the separate
// acceptance ticket serves this destination and owns what the invitee does there.
export const INVITATION_PATH = '/auth/invite';

export function invitationDestination(appUrl: string): string {
  return new URL(INVITATION_PATH, appUrl).toString();
}

export type InvitationSendRequest = { email: string };

// What the server adapter can prove about one address the provider refused. `unknown` is kept
// apart from `absent`: only a lookup that read every page may claim there is no identity.
export type ProviderIdentity =
  | { outcome: 'found'; providerUserId: string }
  | { outcome: 'absent' }
  | { outcome: 'unknown'; detail: string };

export interface InvitationSender {
  send(request: InvitationSendRequest): Promise<InvitationProviderResult>;
  // The address lookup used when a refusal needs classifying; absent when the adapter cannot
  // ask the provider anything but the invitation call itself.
  identity?(email: string): Promise<ProviderIdentity>;
}

export type InvitationRecordRequest = {
  invitationId: string;
  revision: number;
  actorId: string;
  email: string;
  result: InvitationProviderResult;
};

// The database gateway. Begin converges on the original invitation for the same actor/key,
// resumes an open invitation for any live admin and refuses a conflicting role or a retained
// employee's address; record advances exactly one revision.
export interface InvitationGateway {
  begin(
    email: string,
    role: EmployeeRole,
    key: string,
  ): Promise<EmployeeInvitation>;
  record(request: InvitationRecordRequest): Promise<EmployeeInvitation>;
}

// Begin, one provider attempt, then the recorded outcome — all against the recorded intended
// address, never a retyped one. A recorded invitation is returned as it is: nothing is
// re-sent, nothing is activated and no provider identity is deleted as compensation.
export async function administerInvitation(
  gateway: InvitationGateway,
  sender: InvitationSender,
  input: { email: string; role: EmployeeRole; key: string; actorId: string },
): Promise<EmployeeInvitation> {
  const invitation = await gateway.begin(input.email, input.role, input.key);
  if (invitation.state === 'recorded') return invitation;
  const result = await settleInvitationSend(sender, {
    email: invitation.email,
  });
  return gateway.record({
    invitationId: invitation.id,
    revision: invitation.revision,
    actorId: input.actorId,
    email: invitation.email,
    result,
  });
}

// The sender is the only path that may claim an accepted provider request. A thrown transport
// failure may have reached the provider, so it is ambiguous rather than a definite refusal,
// and never a recorded invitation.
export async function attemptInvitationSend(
  sender: InvitationSender,
  request: InvitationSendRequest,
): Promise<InvitationProviderResult> {
  try {
    return await sender.send(request);
  } catch (failure) {
    return { outcome: 'ambiguous', detail: providerDetail(failure) };
  }
}

// A 4xx refusal of an address the provider already holds is the stuck case: an earlier send was
// accepted but its recording was lost, so the address has an identity and every later retry is
// refused for it. Recording that as `failed` strands an invitation that reached the person, so
// the refusal is only recorded as `accepted` when the lookup returns the identity of exactly
// that address; a definite `failed` needs a lookup that read every address and found none, and
// an inconclusive lookup stays ambiguous rather than claiming a refusal it did not prove.
export async function settleInvitationSend(
  sender: InvitationSender,
  request: InvitationSendRequest,
): Promise<InvitationProviderResult> {
  const result = await attemptInvitationSend(sender, request);
  if (result.outcome !== 'failed' || !sender.identity) return result;
  let identity: ProviderIdentity;
  try {
    identity = await sender.identity(request.email);
  } catch (failure) {
    return { outcome: 'ambiguous', detail: providerDetail(failure) };
  }
  if (identity.outcome === 'found')
    return isUuid(identity.providerUserId)
      ? { outcome: 'accepted', providerUserId: identity.providerUserId }
      : { outcome: 'ambiguous', detail: 'the provider identity is unreadable' };
  if (identity.outcome === 'absent') return result;
  return { outcome: 'ambiguous', detail: identity.detail };
}

export type InvitationFailure = { code: string; ambiguous: boolean };

// One implementation of the recorded-action failure classification, shared with the
// deactivation interface: a definite refusal cannot have committed, a lost or server-side
// response may have, and only the latter reconciles by re-reading the recorded state.
export const invitationFailure: (
  failure: { status?: number; code?: string } | null,
) => InvitationFailure = deactivationFailure;

export const invitationProblemAfterLoad = deactivationProblemAfterLoad;
