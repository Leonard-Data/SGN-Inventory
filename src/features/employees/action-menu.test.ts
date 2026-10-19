import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  employeeActions,
  menuIndex,
  type EmployeeActionState,
} from './action-menu.ts';

function state(patch: Partial<EmployeeActionState> = {}): EmployeeActionState {
  return {
    access: 'active',
    invitation: null,
    deactivation: null,
    deletion: null,
    actorRole: 'admin',
    ...patch,
  };
}

test('an active employee offers the profile edit, deactivation and deletion', () => {
  assert.deepEqual(employeeActions(state()), [
    'profile',
    'deactivate',
    'delete',
  ]);
});

test('the resend action stays admin-only and needs an unaccepted invitation', () => {
  // A recorded invitation that was never accepted is the only one that may be sent again,
  // and only to a person whose sign-in identity is still unlinked.
  assert.deepEqual(
    employeeActions(
      state({
        access: 'unlinked',
        invitation: { state: 'recorded' },
      }),
    ),
    ['profile', 'resend'],
  );
  assert.deepEqual(
    employeeActions(
      state({
        access: 'unlinked',
        invitation: { state: 'recorded' },
        actorRole: 'manager',
      }),
    ),
    ['profile'],
  );
  // An accepted invitation is gone from the record; a pending one has not finished yet.
  for (const recorded of ['provider_pending', 'provider_failed'] as const) {
    assert.ok(
      !employeeActions(
        state({ access: 'unlinked', invitation: { state: recorded } }),
      ).includes('resend'),
      recorded,
    );
  }
});

test('a half-finished deactivation is offered as its resumable action', () => {
  for (const deactivation of [
    { state: 'provider_pending' as const },
    { state: 'provider_failed' as const },
  ]) {
    assert.deepEqual(employeeActions(state({ deactivation })), [
      'profile',
      'deactivate',
      'delete',
    ]);
  }
  // A completed deactivation leaves nothing to resume, and an inactive employee is no longer
  // deactivatable, but the account is still there to delete.
  assert.deepEqual(
    employeeActions(
      state({ access: 'inactive', deactivation: { state: 'completed' } }),
    ),
    ['delete'],
  );
});

test('a disabled, unlinked or deleted account keeps only the actions that still apply', () => {
  assert.deepEqual(employeeActions(state({ access: 'inactive' })), ['delete']);
  // An imported person with no sign-in identity keeps the profile edit and nothing that
  // would act on an account they do not have.
  assert.deepEqual(employeeActions(state({ access: 'unlinked' })), ['profile']);
  assert.deepEqual(employeeActions(state({ access: 'account_deleted' })), []);
  // A recorded deletion that never completed stays resumable, even once the account is gone.
  assert.deepEqual(
    employeeActions(
      state({
        access: 'account_deleted',
        deletion: { state: 'provider_failed' },
      }),
    ),
    ['delete'],
  );
  assert.deepEqual(
    employeeActions(
      state({ access: 'unlinked', deletion: { state: 'completed' } }),
    ),
    ['profile'],
  );
});

test('the arrow keys move one item and wrap, Home and End reach the ends', () => {
  assert.equal(menuIndex('ArrowDown', 0, 3), 1);
  assert.equal(menuIndex('ArrowDown', 2, 3), 0);
  assert.equal(menuIndex('ArrowUp', 0, 3), 2);
  assert.equal(menuIndex('ArrowUp', 1, 3), 0);
  assert.equal(menuIndex('Home', 2, 3), 0);
  assert.equal(menuIndex('End', 0, 3), 2);
  assert.equal(menuIndex('Home', 0, 1), 0);
  assert.equal(menuIndex('End', 0, 1), 0);
  for (const key of ['Enter', 'Tab', 'Escape', ' ', 'a'])
    assert.equal(menuIndex(key, 0, 3), null, key);
  assert.equal(menuIndex('ArrowDown', 0, 0), null);
});
