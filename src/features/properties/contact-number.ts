import 'server-only';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import { changes, databaseError } from '@/features/property-maintenance/data';

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
