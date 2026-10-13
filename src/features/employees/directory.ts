// The admin employee list reads identities that already exist in `public.employees` under the
// existing employee read and adds no schema, policy or grant. Keeping the paging bounds, the
// access-state projection and the role rule here leaves them testable without a session.
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

export type DirectoryEntry = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  access: EmployeeAccess;
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

export function directoryPage(
  rows: readonly DirectoryRow[],
  size = DIRECTORY_PAGE_SIZE,
): DirectoryPage {
  const page = rows.slice(0, size);
  const last = page[page.length - 1];
  return {
    employees: page.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      email: row.email,
      role: row.role,
      access: accessState(row),
    })),
    nextCursor: rows.length > size && last ? last.id : null,
  };
}

// Admin-only surface. The live role is re-read from the session on every request; this
// names the rule so the route guard, the route's page guard and the tests agree.
export function mayReadDirectory(role: string): boolean {
  return role === 'admin';
}
