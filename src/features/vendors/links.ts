// The bounded shape of one property–vendor link and unlink, validated at the application
// boundary before any RPC runs. Both operations are keyed by the property path and a
// revision the caller actually read, so a stale context is refused instead of silently
// rewriting a relationship somebody else already changed.
import { isUuid } from '../../lib/supabase/query.ts';

export const VENDOR_LINK_BODY_MAX_BYTES = 4 * 1024;
export const VENDOR_PROPERTY_PAGE_SIZE = 50;

export class VendorLinkError extends Error {
  readonly code: 'invalid-input';

  constructor(code: 'invalid-input') {
    super(code);
    this.code = code;
  }
}

function invalid(): never {
  throw new VendorLinkError('invalid-input');
}

export type VendorLinkBody = { vendorId: string; propertyRevision: string };
export type VendorUnlinkBody = { revision: string };

export function vendorLinkBody(body: Record<string, unknown>): VendorLinkBody {
  if (
    Object.keys(body).some(
      (key) => key !== 'vendorId' && key !== 'propertyRevision',
    ) ||
    !isUuid(body.vendorId) ||
    !isUuid(body.propertyRevision)
  )
    invalid();
  return { vendorId: body.vendorId, propertyRevision: body.propertyRevision };
}

export function vendorUnlinkBody(
  body: Record<string, unknown>,
): VendorUnlinkBody {
  if (
    Object.keys(body).some((key) => key !== 'revision') ||
    !isUuid(body.revision)
  )
    invalid();
  return { revision: body.revision };
}

function text(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalid();
  return value;
}

// A recorded link row arrives from the guarded wrapper or a live RLS read; never trust its
// shape. A malformed row is a failed read, not a partially rendered company block.
export function vendorLinkRecord(row: unknown) {
  const value: Record<string, unknown> =
    row && typeof row === 'object' && !Array.isArray(row)
      ? (row as Record<string, unknown>)
      : {};
  const phones =
    value.phones === null
      ? null
      : Array.isArray(value.phones) &&
          value.phones.every((phone) => typeof phone === 'string')
        ? (value.phones as string[])
        : invalid();
  if (
    !isUuid(value.vendor_id) ||
    !isUuid(value.revision) ||
    typeof value.display_name !== 'string' ||
    typeof value.created_at !== 'string'
  )
    invalid();
  return {
    vendorId: value.vendor_id as string,
    revision: value.revision as string,
    displayName: value.display_name,
    contactName: text(value.contact_name),
    phones,
    email: text(value.email),
    linkedAt: value.created_at,
  };
}

// The authorized linked-property projection: the same row shape a property read serves,
// already filtered by the caller's own property access and archived boundary.
export function vendorPropertyRecord(row: unknown) {
  const value: Record<string, unknown> =
    row && typeof row === 'object' && !Array.isArray(row)
      ? (row as Record<string, unknown>)
      : {};
  if (
    !isUuid(value.property_id) ||
    typeof value.property_code !== 'string' ||
    typeof value.status !== 'string' ||
    typeof value.linked_at !== 'string'
  )
    invalid();
  return {
    propertyId: value.property_id as string,
    propertyCode: value.property_code,
    status: value.status,
    archivedAt: text(value.archived_at),
    linkedAt: value.linked_at as string,
  };
}

// One extra row is the follow-page probe, exactly like the other list surfaces: at most 50
// linked properties are exposed and the caller is told the projection was cut short.
export function vendorPropertyPage(rows: readonly unknown[]) {
  const page = rows
    .slice(0, VENDOR_PROPERTY_PAGE_SIZE)
    .map(vendorPropertyRecord);
  return { properties: page, more: rows.length > VENDOR_PROPERTY_PAGE_SIZE };
}

export function vendorLinkRows(rows: readonly unknown[]) {
  return rows.map(vendorLinkRecord);
}
