import 'server-only';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import { changes, databaseError } from '@/features/property-maintenance/data';
import {
  ContactInputError,
  contactDraft,
  contactRequest,
} from '@/features/property-maintenance/create-contact';

// The create screen carries the owner's contact details in its own submission. A half-filled or
// malformed pair is refused before the property is written, and a complete one is submitted in
// the shape the record's capture form sends, so validation stays the operation's own.
export function contactChanges(value: unknown): Record<string, unknown> | null {
  try {
    const draft = contactDraft(value);
    return draft ? contactRequest(draft) : null;
  } catch (failure) {
    if (failure instanceof ContactInputError)
      throw new ApiError(400, 'invalid-input');
    throw failure;
  }
}

// Recording a contact number on a property. Any live active employee may do this on any
// unarchived property, whether or not they may edit its facts: the guarded operation creates
// the contact and its link in one call, so a refusal records neither half. Earlier contacts of
// the property stay stored and linked, and the newest one is the one a reader sees first.
export async function addContactNumber(
  context: RouteContext,
  propertyId: string,
  body: Record<string, unknown>,
) {
  if (!uuid(propertyId)) throw new ApiError(400, 'invalid-input');
  if (Object.keys(body).some((key) => key !== 'changes'))
    throw new ApiError(400, 'invalid-input');
  const { data, error } = await context.client.rpc('add_property_contact', {
    p_property_id: propertyId,
    p_changes: changes('contact', body.changes),
  });
  databaseError(error);
  return { id: data };
}
