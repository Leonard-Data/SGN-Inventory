import { cursorPair, isUuid } from '../../lib/supabase/query.ts';
import type { Vendor, VendorCursor, VendorPage } from './types';

// Directory rules kept outside React so the route, the page and the tests agree on the
// same bounds. The exposed page is at most 30 vendors; the database wrapper returns one
// extra row as the follow-page probe, exactly like the other list surfaces.
export const VENDOR_PAGE_SIZE = 30;
export const VENDOR_QUERY_MAX_LENGTH = 120;

export class VendorDirectoryError extends Error {
  readonly code: 'invalid-input';

  constructor(code: 'invalid-input') {
    super(code);
    this.code = code;
  }
}

export type VendorDirectoryQuery = {
  query: string | null;
  before: string | null;
  beforeId: string | null;
};

// Only the search text and the newest-first cursor pair are accepted; an unknown
// parameter or a half/malformed cursor is refused instead of being served as page one.
export function vendorDirectoryQuery(
  params: URLSearchParams,
): VendorDirectoryQuery {
  const query = params.get('query');
  const cursor = cursorPair(params);
  if (
    [...params.keys()].some(
      (key) => key !== 'query' && key !== 'before' && key !== 'beforeId',
    ) ||
    cursor === 'invalid'
  )
    throw new VendorDirectoryError('invalid-input');
  const text = (query ?? '').trim();
  if ([...text].length > VENDOR_QUERY_MAX_LENGTH)
    throw new VendorDirectoryError('invalid-input');
  return {
    query: text === '' ? null : text,
    before: cursor?.before ?? null,
    beforeId: cursor?.beforeId ?? null,
  };
}

// A recorded vendor row arrives from the guarded RPC or a live RLS read; never trust its
// shape. A malformed row is a failed read, not an empty or partial company identity.
export function vendorRecord(row: unknown): Vendor {
  const value: Record<string, unknown> =
    row && typeof row === 'object' && !Array.isArray(row)
      ? (row as Record<string, unknown>)
      : {};
  const optionalText = (field: unknown): string | null =>
    field === null
      ? null
      : typeof field === 'string'
        ? field
        : (() => {
            throw new VendorDirectoryError('invalid-input');
          })();
  const phones =
    value.phones === null
      ? null
      : Array.isArray(value.phones) &&
          value.phones.every((phone) => typeof phone === 'string')
        ? (value.phones as string[])
        : (() => {
            throw new VendorDirectoryError('invalid-input');
          })();
  if (
    !isUuid(value.id) ||
    typeof value.display_name !== 'string' ||
    typeof value.created_at !== 'string'
  )
    throw new VendorDirectoryError('invalid-input');
  return {
    id: value.id as string,
    displayName: value.display_name,
    contactName: optionalText(value.contact_name),
    phones,
    email: optionalText(value.email),
    sourceAddress: optionalText(value.source_address),
    notes: optionalText(value.notes),
    createdAt: value.created_at,
  };
}

export function vendorPage(rows: readonly unknown[]): VendorPage {
  const page = rows.slice(0, VENDOR_PAGE_SIZE).map(vendorRecord);
  const last = page[page.length - 1];
  const nextCursor: VendorCursor | null =
    rows.length > VENDOR_PAGE_SIZE && last
      ? { before: last.createdAt, beforeId: last.id }
      : null;
  return { vendors: page, nextCursor };
}

// C5: every active employee may read the directory; only staff/manager/admin may create
// or maintain a vendor. Named once so the route guard, the rendered control and the tests
// share it; the database re-checks the live role on every call.
export function mayMaintainVendors(role: string): boolean {
  return role === 'staff' || role === 'manager' || role === 'admin';
}
