// The admin employee list reads identities that already exist in `public.employees` under the
// existing employee read. Keeping the paging bounds, the access-state projection, the
// recorded administration state and the role rule here leaves them testable without a session.
import type { DeactivationState } from './deactivation.ts';
import { mayAdministerEmployees } from './deactivation.ts';

export const DIRECTORY_PAGE_SIZE = 30;

// The columns the projection needs; the select in directory-data.ts returns exactly these.
export type DirectoryRow = {
  id: string;
  display_name: string;
  email: string;
  role: string;
  auth_user_id: string | null;
  is_active: boolean;
};

// Derived only from the recorded Auth link and activation flag. The schema records no
// invitation, so an employee without a linked sign-in identity is `unlinked` — never
// presented as invited, and never as deleted.
export type EmployeeAccess = 'active' | 'inactive' | 'unlinked';

export type DirectoryDeactivation = {
  state: DeactivationState;
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
  // completed deactivation.
  deactivation: DirectoryDeactivation | null;
};

// The columns the operation lookup returns; rows arrive newest-first so the first row for an
// employee is the operation the list reports.
export type DirectoryOperationRow = {
  employee_id: string;
  state: string;
  revision: number;
  updated_at: string;
};

export type DirectoryPage = {
  employees: DirectoryEntry[];
  nextCursor: string | null;
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
  row: Pick<DirectoryRow, 'auth_user_id' | 'is_active'>,
): EmployeeAccess {
  // `not is_active or auth_user_id is not null` is a database check, so an activated
  // employee always has a linked identity and the order below is unambiguous.
  if (!row.auth_user_id) return 'unlinked';
  return row.is_active ? 'active' : 'inactive';
}

export function directoryOperations(
  rows: readonly DirectoryOperationRow[],
): Map<string, DirectoryDeactivation> {
  const latest = new Map<string, DirectoryDeactivation>();
  for (const row of rows) {
    if (
      !row.employee_id ||
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
    });
  }
  return latest;
}

export function directoryPage(
  rows: readonly DirectoryRow[],
  operations: Map<string, DirectoryDeactivation> = new Map(),
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
      deactivation: operations.get(row.id) ?? null,
    })),
    nextCursor: rows.length > DIRECTORY_PAGE_SIZE && last ? last.id : null,
  };
}

// Admin-only surface. The live role is re-read from the session on every request; this
// names the rule so the route guard, the proxy's page guard and the tests agree.
export function mayReadDirectory(role: string): boolean {
  return mayAdministerEmployees(role);
}
