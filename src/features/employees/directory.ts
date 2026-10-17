// The admin employee list reads identities that already exist in `public.employees` under the
// existing employee read. Keeping the paging bounds, the access-state projection, the
// recorded administration state and the role rule here leaves them testable without a session.
import type { DeactivationState } from './deactivation.ts';
import { mayAdministerEmployees } from './deactivation.ts';
import type { InvitationState } from './invitation.ts';

export const DIRECTORY_PAGE_SIZE = 30;

// The columns the projection needs; the select in directory-data.ts returns exactly these.
export type DirectoryRow = {
  id: string;
  display_name: string;
  email: string;
  role: string;
  auth_user_id: string | null;
  is_active: boolean;
  account_deleted_at: string | null;
};

// Derived only from the recorded Auth link, activation flag and retained account-deleted
// state. An employee without a linked sign-in identity is `unlinked` — never presented as
// invited: a recorded invitation is separate evidence with its own marker, so nothing here
// infers one from a null Auth link. `account_deleted` is a retained lifecycle state
// of the same employee row, so a deleted sign-in account is never confused with a person who
// was never linked or whose access was only disabled.
export type EmployeeAccess =
  'active' | 'inactive' | 'unlinked' | 'account_deleted';

export type DirectoryDeactivation = {
  state: DeactivationState;
  revision: number;
  updatedAt: string;
  // The recorded provider outcome, so a blocked Storage ownership step is not presented as a
  // generic provider failure.
  outcome: string | null;
};

// The recorded invitation state for one employee. `recorded` is the provider accepting the
// invitation request, not proof that the mailbox received the message, and never active
// access.
export type DirectoryInvitation = {
  state: InvitationState;
  revision: number;
  updatedAt: string;
};

export type DirectoryEntry = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  access: EmployeeAccess;
  // The recorded administration state for this employee, or null when no operation exists.
  // A disabled membership with `provider_pending`/`provider_failed` is never presented as a
  // completed deactivation, and a deleted sign-in account is never presented as a completed
  // deactivation or the reverse: each kind has its own recorded state.
  deactivation: DirectoryDeactivation | null;
  deletion: DirectoryDeactivation | null;
  // The recorded invitation state, or null when this employee has never been invited. An
  // unlinked imported person carries none, so nothing here invents an invitation marker.
  invitation: DirectoryInvitation | null;
};

// The columns the operation lookup returns; rows arrive newest-first so the first row of a
// kind for an employee is the operation the list reports.
export type DirectoryOperationRow = {
  employee_id: string;
  kind: string;
  state: string;
  revision: number;
  updated_at: string;
  provider_outcome: string | null;
};

export type DirectoryPage = {
  employees: DirectoryEntry[];
  nextCursor: string | null;
};

// The columns the invitation lookup returns; rows arrive newest-first so the first row for an
// employee is the invitation the list reports.
export type DirectoryInvitationRow = {
  employee_id: string;
  state: string;
  revision: number;
  updated_at: string;
};

export type DirectoryQuery = { after: string | null };

export class DirectoryError extends Error {
  constructor(public readonly code: 'invalid-input') {
    super(code);
  }
}

const cursorPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Keyset paging on the primary key, mirroring the contact list: the cursor is the last
// returned id and nothing else is accepted from the caller.
export function directoryQuery(params: URLSearchParams): DirectoryQuery {
  const after = params.get('after');
  if (
    [...params.keys()].some((key) => key !== 'after') ||
    (after !== null && !cursorPattern.test(after))
  )
    throw new DirectoryError('invalid-input');
  return { after };
}

export function accessState(
  row: Pick<DirectoryRow, 'auth_user_id' | 'is_active' | 'account_deleted_at'>,
): EmployeeAccess {
  // A recorded account deletion is checked first because it is the only state that also has
  // no linked identity; `not is_active or auth_user_id is not null` is a database check, so
  // an activated employee always has a linked identity and the order below is unambiguous.
  if (row.account_deleted_at) return 'account_deleted';
  if (!row.auth_user_id) return 'unlinked';
  return row.is_active ? 'active' : 'inactive';
}

export function directoryOperations(
  rows: readonly DirectoryOperationRow[],
  kind: 'deactivate' | 'delete',
): Map<string, DirectoryDeactivation> {
  const latest = new Map<string, DirectoryDeactivation>();
  for (const row of rows) {
    if (
      !row.employee_id ||
      row.kind !== kind ||
      !['provider_pending', 'provider_failed', 'completed'].includes(
        row.state,
      ) ||
      typeof row.revision !== 'number' ||
      !Number.isInteger(row.revision) ||
      typeof row.updated_at !== 'string' ||
      !Number.isFinite(Date.parse(row.updated_at)) ||
      latest.has(row.employee_id)
    )
      continue;
    latest.set(row.employee_id, {
      state: row.state as DeactivationState,
      revision: row.revision,
      updatedAt: row.updated_at,
      outcome:
        typeof row.provider_outcome === 'string' ? row.provider_outcome : null,
    });
  }
  return latest;
}

// The recorded invitations the list marks, from the same newest-first rows: the invitation
// list extension uses real lifecycle markers, never a status guessed from a null Auth link. A
// row whose state this projection does not recognise is skipped, never guessed.
const invitationStates: readonly InvitationState[] = [
  'provider_pending',
  'provider_failed',
  'recorded',
];

export function directoryInvitations(
  rows: readonly DirectoryInvitationRow[],
): Map<string, DirectoryInvitation> {
  const latest = new Map<string, DirectoryInvitation>();
  for (const row of rows) {
    if (
      !row.employee_id ||
      !invitationStates.includes(row.state as InvitationState) ||
      typeof row.revision !== 'number' ||
      !Number.isInteger(row.revision) ||
      typeof row.updated_at !== 'string' ||
      !Number.isFinite(Date.parse(row.updated_at)) ||
      latest.has(row.employee_id)
    )
      continue;
    latest.set(row.employee_id, {
      state: row.state as InvitationState,
      revision: row.revision,
      updatedAt: row.updated_at,
    });
  }
  return latest;
}

export function directoryPage(
  rows: readonly DirectoryRow[],
  operations: {
    deactivation?: Map<string, DirectoryDeactivation>;
    deletion?: Map<string, DirectoryDeactivation>;
  } = {},
): DirectoryPage {
  const page = rows.slice(0, DIRECTORY_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    employees: page.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      email: row.email,
      role: row.role,
      access: accessState(row),
      deactivation: operations.deactivation?.get(row.id) ?? null,
      deletion: operations.deletion?.get(row.id) ?? null,
      invitation: null,
    })),
    nextCursor: rows.length > DIRECTORY_PAGE_SIZE && last ? last.id : null,
  };
}

// Admin-only surface. The live role is re-read from the session on every request; this
// names the rule so the route guard, the proxy's page guard and the tests agree.
export function mayReadDirectory(role: string): boolean {
  return mayAdministerEmployees(role);
}
