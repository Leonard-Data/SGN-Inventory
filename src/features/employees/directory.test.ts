import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DIRECTORY_PAGE_SIZE,
  DirectoryError,
  accessState,
  directoryInvitations,
  directoryOperations,
  directoryPage,
  directoryQuery,
  mayReadDirectory,
  type DirectoryRow,
} from './directory.ts';
import { messages } from '../../i18n/messages.ts';

function row(index: number, patch: Partial<DirectoryRow> = {}): DirectoryRow {
  return {
    id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
    display_name: `Fixture ${index}`,
    email: `fixture${index}@example.test`,
    role: 'sales',
    auth_user_id: `${String(index).padStart(8, '0')}-0000-4000-8000-0000000000ff`,
    is_active: true,
    account_deleted_at: null,
    ...patch,
  };
}

test('recorded link and activation decide the access state', () => {
  assert.equal(accessState(row(1)), 'active');
  assert.equal(accessState(row(2, { is_active: false })), 'inactive');
  // An imported person with no linked sign-in identity is unlinked: a recorded invitation is
  // separate evidence, so nothing here may present them as invited from the null link alone.
  assert.equal(accessState(row(3, { auth_user_id: null })), 'unlinked');
  assert.equal(
    accessState(row(4, { auth_user_id: null, is_active: false })),
    'unlinked',
  );
  // A retained employee whose sign-in account was deleted is its own state: it is never
  // shown as an imported person who was never linked, nor as a merely disabled account.
  assert.equal(
    accessState(
      row(5, {
        auth_user_id: null,
        is_active: false,
        account_deleted_at: '2026-10-15T04:00:00Z',
      }),
    ),
    'account_deleted',
  );
});

test('the four access states stay distinguishable in both languages', () => {
  for (const locale of ['vi', 'en'] as const) {
    const labels = [
      messages[locale].employeeAccessActive,
      messages[locale].employeeAccessInactive,
      messages[locale].employeeAccessUnlinked,
      messages[locale].employeeAccessAccountDeleted,
    ];
    assert.equal(new Set(labels).size, 4, `${locale} labels must differ`);
    assert.ok(
      !/invit|mời/i.test(messages[locale].employeeAccessUnlinked),
      `${locale} must not call an unlinked employee invited`,
    );
  }
});

test('a page is bounded and keeps the database ordering', () => {
  const rows = Array.from({ length: DIRECTORY_PAGE_SIZE + 1 }, (_, index) =>
    row(index),
  );
  const page = directoryPage(rows);
  assert.equal(page.employees.length, DIRECTORY_PAGE_SIZE);
  assert.equal(page.nextCursor, page.employees.at(-1)!.id);
  assert.deepEqual(
    page.employees.map((employee) => employee.id),
    rows.slice(0, DIRECTORY_PAGE_SIZE).map((value) => value.id),
  );
  assert.deepEqual(page.employees[0], {
    id: rows[0]!.id,
    displayName: rows[0]!.display_name,
    email: rows[0]!.email,
    role: rows[0]!.role,
    access: 'active',
    deactivation: null,
    deletion: null,
    invitation: null,
  });
});

test('the recorded administration state is attached to its employee', () => {
  const rows = [row(1), row(2)];
  // Rows arrive newest-first, so the first row of a kind for an employee is the state
  // displayed, and the two lifecycle kinds are projected separately.
  const operations = directoryOperations(
    [
      {
        employee_id: rows[0]!.id,
        kind: 'deactivate',
        state: 'provider_failed',
        revision: 2,
        updated_at: '2026-10-13T10:00:00Z',
        provider_outcome: 'ambiguous',
      },
      {
        employee_id: rows[0]!.id,
        kind: 'deactivate',
        state: 'provider_pending',
        revision: 1,
        updated_at: '2026-10-13T09:00:00Z',
        provider_outcome: null,
      },
      {
        employee_id: rows[0]!.id,
        kind: 'delete',
        state: 'provider_failed',
        revision: 1,
        updated_at: '2026-10-14T09:00:00Z',
        provider_outcome: 'storage_blocked',
      },
      {
        employee_id: rows[1]!.id,
        kind: 'deactivate',
        state: 'unsupported',
        revision: 1,
        updated_at: '2026-10-13T09:00:00Z',
        provider_outcome: null,
      },
    ],
    'deactivate',
  );
  const deletions = directoryOperations(
    [
      {
        employee_id: rows[0]!.id,
        kind: 'delete',
        state: 'provider_failed',
        revision: 1,
        updated_at: '2026-10-14T09:00:00Z',
        provider_outcome: 'storage_blocked',
      },
      {
        employee_id: rows[0]!.id,
        kind: 'deactivate',
        state: 'completed',
        revision: 2,
        updated_at: '2026-10-13T10:00:00Z',
        provider_outcome: 'blocked',
      },
    ],
    'delete',
  );
  const page = directoryPage(rows, {
    deactivation: operations,
    deletion: deletions,
  });
  assert.deepEqual(page.employees[0]!.deactivation, {
    state: 'provider_failed',
    revision: 2,
    updatedAt: '2026-10-13T10:00:00Z',
    outcome: 'ambiguous',
  });
  assert.deepEqual(page.employees[0]!.deletion, {
    state: 'provider_failed',
    revision: 1,
    updatedAt: '2026-10-14T09:00:00Z',
    outcome: 'storage_blocked',
  });
  // An unreadable or unknown state is never shown as a lifecycle state, and a deactivation
  // is never projected as a deletion or the reverse.
  assert.equal(page.employees[1]!.deactivation, null);
  assert.equal(page.employees[1]!.deletion, null);
});

test('a last or empty page carries no cursor', () => {
  assert.equal(directoryPage([]).nextCursor, null);
  assert.deepEqual(directoryPage([]).employees, []);
  const exact = directoryPage(
    Array.from({ length: DIRECTORY_PAGE_SIZE }, (_, index) => row(index)),
  );
  assert.equal(exact.employees.length, DIRECTORY_PAGE_SIZE);
  assert.equal(exact.nextCursor, null);
});

test('only a UUID cursor is accepted and unknown parameters are refused', () => {
  assert.deepEqual(directoryQuery(new URLSearchParams()), { after: null });
  const cursor = row(1).id;
  assert.deepEqual(directoryQuery(new URLSearchParams({ after: cursor })), {
    after: cursor,
  });
  for (const query of [
    { after: 'not-a-uuid' },
    { after: '' },
    { query: cursor },
    { after: cursor, extra: '1' },
  ] as Record<string, string>[])
    assert.throws(
      () => directoryQuery(new URLSearchParams(query)),
      DirectoryError,
      JSON.stringify(query),
    );
});

test('the employee list is admin-only', () => {
  assert.equal(mayReadDirectory('admin'), true);
  for (const role of ['manager', 'staff', 'sales', 'unknown'])
    assert.equal(mayReadDirectory(role), false, role);
});

test('the recorded deactivation states are distinct in both languages', () => {
  for (const locale of ['vi', 'en'] as const) {
    const labels = [
      messages[locale].employeeDeactivatePendingLabel,
      messages[locale].employeeDeactivateReconciliationLabel,
      messages[locale].employeeDeactivateConfirmedLabel,
    ];
    assert.equal(new Set(labels).size, 3, `${locale} labels must differ`);
  }
});

test('the recorded deletion states are distinct in both languages', () => {
  for (const locale of ['vi', 'en'] as const) {
    const labels = [
      messages[locale].employeeDeletePendingLabel,
      messages[locale].employeeDeleteReconciliationLabel,
      messages[locale].employeeDeleteStorageBlockedLabel,
      messages[locale].employeeDeleteConfirmedLabel,
      messages[locale].employeeAccessInactive,
      messages[locale].employeeAccessAccountDeleted,
    ];
    assert.equal(new Set(labels).size, 6, `${locale} labels must differ`);
  }
});

test('the recorded invitation projection reports the newest state per employee', () => {
  const rows = [row(1), row(2)];
  const invitations = directoryInvitations([
    {
      employee_id: rows[0]!.id,
      state: 'provider_failed',
      revision: 2,
      updated_at: '2026-10-15T10:00:00Z',
    },
    {
      employee_id: rows[0]!.id,
      state: 'provider_pending',
      revision: 1,
      updated_at: '2026-10-15T09:00:00Z',
    },
    {
      employee_id: rows[1]!.id,
      state: 'completed',
      revision: 1,
      updated_at: '2026-10-15T09:00:00Z',
    },
  ]);
  assert.deepEqual(invitations.get(rows[0]!.id), {
    state: 'provider_failed',
    revision: 2,
    updatedAt: '2026-10-15T10:00:00Z',
  });
  // A deactivation state is not an invitation state, and an employee without a recorded
  // invitation carries no marker at all.
  assert.equal(invitations.get(rows[1]!.id), undefined);
  assert.equal(directoryPage(rows).employees[0]!.invitation, null);
});

test('an employee with no recorded invitation is never presented as invited', () => {
  const page = directoryPage([
    row(1, { auth_user_id: null, is_active: false }),
  ]);
  assert.equal(page.employees[0]!.access, 'unlinked');
  assert.equal(page.employees[0]!.invitation, null);
  for (const locale of ['vi', 'en'] as const) {
    const labels = [
      messages[locale].employeeInvitePendingLabel,
      messages[locale].employeeInviteReconciliationLabel,
      messages[locale].employeeInviteRecordedLabel,
    ];
    assert.equal(new Set(labels).size, 3, `${locale} labels must differ`);
    assert.ok(
      !/đã gửi|delivered|mailbox received/i.test(labels.join(' ')),
      `${locale} must not claim the mailbox received the invitation`,
    );
  }
});
