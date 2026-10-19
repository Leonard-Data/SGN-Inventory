// The employee row's actions are one menu, not a row of buttons. Which actions a row offers
// and how the keyboard walks them live here, so both rules are testable without a session or
// a browser; the guards are the same ones the confirmation panels behind them use.
import { mayAdministerEmployees } from './deactivation.ts';
import type { DeactivationState } from './deactivation.ts';
import { deletionResumable } from './deletion.ts';
import { resendableInvitation } from './invitation.ts';
import type { InvitationState } from './invitation.ts';
import { profileEditable } from './profile.ts';
import type { EmployeeAccess } from './directory.ts';

export type EmployeeActionId = 'profile' | 'resend' | 'deactivate' | 'delete';

export type EmployeeActionState = {
  access: EmployeeAccess;
  invitation: { state: InvitationState } | null;
  deactivation: { state: DeactivationState } | null;
  deletion: { state: DeactivationState } | null;
  actorRole: string;
};

// The same conditions, in the same order, the row has offered since #160: the profile edit
// for an editable employee, resend for an invitation that was never accepted, deactivate (or
// resume a recorded half-finished deactivation) and delete.
export function employeeActions({
  access,
  invitation,
  deactivation,
  deletion,
  actorRole,
}: EmployeeActionState): EmployeeActionId[] {
  const actions: EmployeeActionId[] = [];
  if (profileEditable(access)) actions.push('profile');
  if (
    mayAdministerEmployees(actorRole) &&
    resendableInvitation(invitation, access)
  )
    actions.push('resend');
  const resumable =
    deactivation?.state === 'provider_pending' ||
    deactivation?.state === 'provider_failed';
  if (access === 'active' || resumable) actions.push('deactivate');
  // Only an employee whose sign-in account is still linked has an account left to delete; a
  // recorded deletion that never completed stays resumable.
  if (
    access === 'active' ||
    access === 'inactive' ||
    deletionResumable(deletion)
  )
    actions.push('delete');
  return actions;
}

// The menu's keyboard contract: the arrow keys move one item and wrap at the ends, Home and
// End jump to the ends, and every other key leaves the focus where it is.
export function menuIndex(
  key: string,
  index: number,
  length: number,
): number | null {
  if (length < 1) return null;
  if (key === 'ArrowDown') return (index + 1) % length;
  if (key === 'ArrowUp') return (index - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return null;
}
