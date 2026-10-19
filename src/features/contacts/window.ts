import { isUuid } from '../../lib/supabase/query.ts';
import type { CursorPage } from '@/features/stream/window';
import type { ContactLink, ContactSummary } from './types';

// Directory rule kept outside React so the window parser and its tests agree: a contact row
// arrives already projected by the route, and a malformed row is a failed read rather than a
// shorter window that would end the stream early.
export class ContactWindowError extends Error {
  readonly code: 'invalid-input';

  constructor() {
    super('invalid-input');
    this.code = 'invalid-input';
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ContactWindowError();
  return value as Record<string, unknown>;
}

function optionalText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new ContactWindowError();
  return value;
}

function contactLink(value: unknown): ContactLink {
  const row = record(value);
  if (
    !isUuid(row.propertyId) ||
    typeof row.propertyCode !== 'string' ||
    typeof row.relation !== 'string' ||
    typeof row.isPrimary !== 'boolean' ||
    typeof row.archived !== 'boolean'
  )
    throw new ContactWindowError();
  return {
    propertyId: row.propertyId,
    propertyCode: row.propertyCode,
    relation: row.relation,
    isPrimary: row.isPrimary,
    archived: row.archived,
  };
}

// One contact as the read states it. The linked-property count is derived here from the same
// links the row lists, never taken from a separate tally that could disagree with them.
function contactRow(value: unknown): ContactSummary {
  const row = record(value);
  if (
    !isUuid(row.id) ||
    typeof row.displayName !== 'string' ||
    typeof row.contactType !== 'string' ||
    !Array.isArray(row.phones) ||
    !row.phones.every((phone) => typeof phone === 'string') ||
    !isUuid(row.revision) ||
    !Array.isArray(row.links)
  )
    throw new ContactWindowError();
  const links = (row.links as unknown[]).map(contactLink);
  return {
    id: row.id,
    displayName: row.displayName,
    contactType: row.contactType,
    phones: row.phones as string[],
    rawPhoneText: optionalText(row.rawPhoneText),
    revision: row.revision,
    links,
    propertyCount: links.filter((link) => !link.archived).length,
  };
}

// One window of the contact directory's paged read as the route states it: the contacts it holds
// and the cursor after them. It is parsed here rather than in the route because the stream reads
// these windows in the browser; a malformed envelope or a malformed row is a failed read, never a
// shorter page that would silently end the stream.
export function contactWindow(payload: unknown): CursorPage<ContactSummary> {
  const page = record(payload);
  if (
    !Array.isArray(page.contacts) ||
    !(page.nextCursor === null || typeof page.nextCursor === 'string')
  )
    throw new ContactWindowError();
  return {
    rows: page.contacts.map(contactRow),
    next: page.nextCursor,
  };
}
