import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeDetailAction,
  canEditDetail,
  type DetailAction,
} from './detail-actions.ts';

type TestEmployee = { id: string; role: 'sales' | 'staff' | 'manager' | 'admin' };
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

function employee(
  id: string,
  role: TestEmployee['role'],
): TestEmployee {
  return { id, role };
}

test('an employee without property edit authority cannot open Edit', () => {
  const colleague = employee('colleague', 'sales');

  assert.equal(canEditDetail(colleague, property), false);
  assert.equal(
    activeDetailAction(
      { tool: 'edit', forEmployee: colleague, propertyId: property.id },
      colleague,
      property,
    ),
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
