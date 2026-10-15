import 'server-only';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import {
  changes,
  databaseError,
  exactKeys,
} from '@/features/property-maintenance/data';
import {
  CONTACT_PAGE_SIZE,
  ContactDirectoryError,
  contactDirectoryQuery,
  contactPage,
} from './directory';
import type { ContactPage } from './types';

// Bounded directory read through the invoker wrapper: RLS decides every row and the wrapper
// clamps the page. One extra row detects a following page; at most 30 are exposed. The
// recorded Owner view filters on the property relationship, and the link projection carries
// only relationships the caller may read, so an archived property outside the caller's
// authority is neither listed nor used as owner membership.
export async function listContacts(
  context: RouteContext,
  params: URLSearchParams,
): Promise<ContactPage> {
  let query;
  try {
    query = contactDirectoryQuery(params);
  } catch (failure) {
    throw new ApiError(
      400,
      failure instanceof ContactDirectoryError ? failure.code : 'invalid-input',
    );
  }
  const { data, error } = await context.client.rpc('list_contacts', {
    p_limit: CONTACT_PAGE_SIZE + 1,
    ...(query.query ? { p_query: query.query } : {}),
    ...(query.after ? { p_after_id: query.after } : {}),
    ...(query.view === 'owners' ? { p_owners_only: true } : {}),
  });
  if (error) databaseError(error);
  try {
    return contactPage(data ?? []);
  } catch (failure) {
    if (failure instanceof ContactDirectoryError)
      throw new ApiError(503, 'unavailable');
    throw failure;
  }
}

// One contact-scoped correction of the shared identity. It is the same database operation
// the property maintenance branch delegates to: the same allowlist, revision check,
// affected-set boundary and archived-property refusal. A recorded shared-contact correction
// appends no property history row (issue #109 narrowed `property_history` to asking prices)
// and still raises the pending review flag on every linked property. No parent property is
// supplied or invented, so an unlinked identity is corrected on its own terms.
export async function maintainContact(
  context: RouteContext,
  id: string,
  body: Record<string, unknown>,
) {
  exactKeys(body, ['revision', 'changes']);
  if (!uuid(id) || !uuid(body.revision))
    throw new ApiError(400, 'invalid-input');
  const { data, error } = await context.client.rpc('maintain_contact', {
    p_contact_id: id,
    p_expected_revision: body.revision,
    p_changes: changes('contact', body.changes),
  });
  databaseError(error);
  return { id: data };
}
