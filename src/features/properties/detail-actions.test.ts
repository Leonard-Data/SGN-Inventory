import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeDetailAction,
  activeDetailDisclosure,
  canEditContactDetail,
  canEditDetail,
  canOpenEditDetail,
  type DetailAction,
} from './detail-actions.ts';

type TestEmployee = {
  id: string;
  role: 'sales' | 'staff' | 'manager' | 'admin';
};
type TestProperty = {
  id: string;
  created_by: string;
  archived_at: string | null;
};

const property: TestProperty = {
  id: 'property-1',
  created_by: 'owner',
  archived_at: null,
};

function employee(id: string, role: TestEmployee['role']): TestEmployee {
  return { id, role };
}

test('an employee with shared-contact authority can open Edit', () => {
  const colleague = employee('colleague', 'sales');

  assert.equal(canEditDetail(colleague, property), false);
  assert.equal(canOpenEditDetail(colleague, property), true);
  assert.equal(
    activeDetailAction(
      { tool: 'edit', forEmployee: colleague, propertyId: property.id },
      colleague,
      property,
    ),
    'edit',
  );
});

test('shared-contact Edit stays closed for a non-reviewer on an archived property', () => {
  const colleague = employee('colleague', 'sales');
  const archived = { ...property, archived_at: '2026-01-01T00:00:00Z' };

  assert.equal(canEditContactDetail(colleague, archived), false);
  assert.equal(canOpenEditDetail(colleague, archived), false);
  assert.equal(
    activeDetailAction(
      { tool: 'edit', forEmployee: colleague, propertyId: archived.id },
      colleague,
      archived,
    ),
    null,
  );
});

test('shared-contact Edit remains available to reviewers on an archived property', () => {
  const reviewer = employee('reviewer', 'manager');
  const archived = { ...property, archived_at: '2026-01-01T00:00:00Z' };

  assert.equal(canEditDetail(reviewer, archived), false);
  assert.equal(canEditContactDetail(reviewer, archived), true);
  assert.equal(canOpenEditDetail(reviewer, archived), true);
});

test('owner disclosure cannot be reused by another employee session', () => {
  const disclosure = {
    propertyId: property.id,
    employeeId: 'employee-a',
    value: '0900000000',
  };

  assert.equal(
    activeDetailDisclosure(disclosure, property.id, 'employee-a'),
    '0900000000',
  );
  assert.equal(
    activeDetailDisclosure(disclosure, property.id, 'employee-b'),
    null,
  );
});

test('a tool opened by an earlier employee session stays closed after revalidation', () => {
  const opener = employee('editor', 'staff');
  const current = employee('editor', 'sales');
  const action: DetailAction = {
    tool: 'edit',
    forEmployee: opener,
    propertyId: property.id,
  };

  assert.equal(activeDetailAction(action, current, property), null);
});
