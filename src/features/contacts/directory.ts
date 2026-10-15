import { isUuid } from '../../lib/supabase/query.ts';
import type {
  ContactLink,
  ContactPage,
  ContactSummary,
  ContactView,
} from './types';

// Directory rules kept outside React so the route, the pages and the tests agree on the
// same bounds. The exposed page is at most 30 contacts; the database wrapper returns one
// extra row as the follow-page probe, exactly like the other list surfaces. Paging is an
// ascending id keyset, the cursor shape the existing contact endpoint already used.
export const CONTACT_PAGE_SIZE = 30;
export const CONTACT_QUERY_MAX_LENGTH = 120;

export class ContactDirectoryError extends Error {
  readonly code: 'invalid-input';

  constructor(code: 'invalid-input') {
    super(code);
    this.code = code;
  }
}

export type ContactDirectoryQuery = {
  query: string | null;
  after: string | null;
  view: ContactView;
};

// Only the name query, the id cursor and the recorded Owner view are accepted; an unknown
// parameter, a half/malformed cursor or an over-long query is refused instead of being
// served as page one. `view=owners` selects identities with a recorded `relation = owner`
// link; it never filters on the identity's global `contact_type`.
export function contactDirectoryQuery(
  params: URLSearchParams,
): ContactDirectoryQuery {
  const query = params.get('query');
  const after = params.get('after');
  const view = params.get('view');
  if (
    [...params.keys()].some(
      (key) => key !== 'query' && key !== 'after' && key !== 'view',
    ) ||
    (after !== null && !isUuid(after)) ||
    (view !== null && view !== '' && view !== 'all' && view !== 'owners')
  )
    throw new ContactDirectoryError('invalid-input');
  const text = (query ?? '').trim();
  if ([...text].length > CONTACT_QUERY_MAX_LENGTH)
    throw new ContactDirectoryError('invalid-input');
  return {
    query: text === '' ? null : text,
    after,
    view: view === 'owners' ? 'owners' : 'all',
  };
}

function optionalText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string')
    throw new ContactDirectoryError('invalid-input');
  return value;
}

function contactLink(value: unknown): ContactLink {
  const row: Record<string, unknown> =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  if (
    !isUuid(row.property_id) ||
    typeof row.property_code !== 'string' ||
    typeof row.relation !== 'string' ||
    typeof row.is_primary !== 'boolean'
  )
    throw new ContactDirectoryError('invalid-input');
  return {
    propertyId: row.property_id,
    propertyCode: row.property_code,
    relation: row.relation,
    isPrimary: row.is_primary,
  };
}

// A recorded contact row arrives from the bounded RPC or a live RLS read; never trust its
// shape. A malformed row is a failed read, not an empty or partial person.
export function contactSummary(row: unknown): ContactSummary {
  const value: Record<string, unknown> =
    row && typeof row === 'object' && !Array.isArray(row)
      ? (row as Record<string, unknown>)
      : {};
  if (
    !isUuid(value.id) ||
    !isUuid(value.revision) ||
    typeof value.display_name !== 'string' ||
    typeof value.contact_type !== 'string' ||
    !Array.isArray(value.phones) ||
    !value.phones.every((phone) => typeof phone === 'string') ||
    !Array.isArray(value.links)
  )
    throw new ContactDirectoryError('invalid-input');
  return {
    id: value.id,
    displayName: value.display_name,
    contactType: value.contact_type,
    phones: value.phones as string[],
    rawPhoneText: optionalText(value.raw_phone_text),
    revision: value.revision,
    links: (value.links as unknown[]).map(contactLink),
  };
}

export function contactPage(rows: readonly unknown[]): ContactPage {
  const page = rows.slice(0, CONTACT_PAGE_SIZE).map(contactSummary);
  const last = page[page.length - 1];
  return {
    contacts: page,
    nextCursor: rows.length > CONTACT_PAGE_SIZE && last ? last.id : null,
  };
}
