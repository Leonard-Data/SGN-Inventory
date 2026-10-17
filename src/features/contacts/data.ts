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

// A bounded name-only read of one recorded identity under the same `contacts` member read the
// directory lists with. It runs no affected-property guard, so naming the person an applied
// filter condition refers to never depends on the caller's preview authority.
export async function contactNameById(
  context: RouteContext,
  id: string,
): Promise<{ id: string; displayName: string }> {
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  const { data, error } = await context.client
    .from('contacts')
    .select('id,display_name')
    .eq('id', id)
    .maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new ApiError(404, 'not-found');
  return { id: data.id, displayName: data.display_name };
}

// One contact-scoped correction of the shared identity. It is the same database operation
// the property maintenance branch delegates to: the same allowlist, revision check,
// affected-set boundary and archived-property refusal. A recorded shared-contact correction
// appends no property history row (issue #109 narrowed `property_history` to asking prices)
// and still raises the pending review flag on every linked property. Unlinked-identity
// correction from the directory is withheld until C2 (#72), so the save requires at least
// one readable property link.
export async function maintainContact(
  context: RouteContext,
  id: string,
  body: Record<string, unknown>,
) {
  exactKeys(body, ['revision', 'changes']);
  if (!uuid(id) || !uuid(body.revision))
    throw new ApiError(400, 'invalid-input');
  const impact = await context.client.rpc('contact_impact', {
    p_contact_id: id,
  });
  databaseError(impact.error);
  const affected = (impact.data as { properties: { id: string }[] } | null)
    ?.properties;
  if (!affected?.length) throw new ApiError(403, 'contact-refusal');
  const { data, error } = await context.client.rpc('maintain_contact', {
    p_contact_id: id,
    p_expected_revision: body.revision,
    p_changes: changes('contact', body.changes),
  });
  databaseError(error);
  return { id: data };
}
