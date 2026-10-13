import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DIRECTORY_PAGE_SIZE,
  DirectoryError,
  accessState,
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
    ...patch,
  };
}

test('recorded link and activation decide the access state', () => {
  assert.equal(accessState(row(1)), 'active');
  assert.equal(accessState(row(2, { is_active: false })), 'inactive');
  // An imported person with no linked sign-in identity is unlinked: the schema records no
  // invitation, so nothing here may present them as invited.
  assert.equal(accessState(row(3, { auth_user_id: null })), 'unlinked');
  assert.equal(
    accessState(row(4, { auth_user_id: null, is_active: false })),
    'unlinked',
  );
});

test('the three access states stay distinguishable in both languages', () => {
  for (const locale of ['vi', 'en'] as const) {
    const labels = [
      messages[locale].employeeAccessActive,
      messages[locale].employeeAccessInactive,
      messages[locale].employeeAccessUnlinked,
    ];
    assert.equal(new Set(labels).size, 3, `${locale} labels must differ`);
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
  });
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
