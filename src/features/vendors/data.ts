import 'server-only';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import {
  VENDOR_PAGE_SIZE,
  VendorDirectoryError,
  mayMaintainVendors,
  vendorDirectoryQuery,
  vendorPage,
  vendorRecord,
} from './directory';
import { VendorDraftError, vendorDraft } from './draft';
import {
  VENDOR_PROPERTY_PAGE_SIZE,
  VendorLinkError,
  vendorLinkBody,
  vendorLinkRecord,
  vendorLinkRows,
  vendorPropertyPage,
  vendorUnlinkBody,
} from './links';
import type {
  Vendor,
  VendorLinkedProperties,
  VendorLink,
  VendorPage,
} from './types';

function databaseError(error: { code?: string }) {
  const denied = error.code === '42501';
  throw new ApiError(
    denied ? 403 : 503,
    denied ? 'access-denied' : 'unavailable',
  );
}

// A malformed response is a failed read, never a partially rendered company record.
function recordOr503(row: unknown): Vendor {
  try {
    return vendorRecord(row);
  } catch (failure) {
    if (failure instanceof VendorDirectoryError)
      throw new ApiError(503, 'unavailable');
    throw failure;
  }
}

// Bounded list read through the invoker wrapper: RLS decides every row and the wrapper
// clamps the page. One extra row detects a following page; at most 30 are exposed.
export async function listVendors(
  context: RouteContext,
  params: URLSearchParams,
): Promise<VendorPage> {
  let query;
  try {
    query = vendorDirectoryQuery(params);
  } catch (failure) {
    throw new ApiError(
      400,
      failure instanceof VendorDirectoryError ? failure.code : 'invalid-input',
    );
  }
  const { data, error } = await context.client.rpc('list_vendors', {
    p_limit: VENDOR_PAGE_SIZE + 1,
    ...(query.query ? { p_query: query.query } : {}),
    ...(query.before && query.beforeId
      ? { p_before_created_at: query.before, p_before_id: query.beforeId }
      : {}),
  });
  if (error) databaseError(error);
  return vendorPage(data ?? []);
}

// Detail under the same live-employee RLS read: no privileged fallback and no vendor
// identifier from the caller other than the bounded UUID. The linked-property projection
// is filtered by the caller's own property access, so an archived property outside their
// role is absent rather than disclosed.
export async function vendorDetail(
  context: RouteContext,
  id: string,
): Promise<{ vendor: Vendor } & VendorLinkedProperties> {
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  const { data, error } = await context.client
    .from('vendors')
    .select(
      'id,display_name,contact_name,phones,email,source_address,notes,created_at',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new ApiError(404, 'not-found');
  const vendor = recordOr503(data);
  const linked = await context.client.rpc('list_vendor_properties', {
    p_vendor_id: id,
    p_limit: VENDOR_PROPERTY_PAGE_SIZE + 1,
  });
  if (linked.error) databaseError(linked.error);
  return linkedOr503(vendor, linked.data);
}

// A malformed projection row is a failed read, never a truncated or invented reach.
function linkedOr503(
  vendor: Vendor,
  rows: unknown,
): {
  vendor: Vendor;
} & VendorLinkedProperties {
  try {
    return { vendor, ...vendorPropertyPage(Array.isArray(rows) ? rows : []) };
  } catch (failure) {
    if (failure instanceof VendorLinkError)
      throw new ApiError(503, 'unavailable');
    throw failure;
  }
}

// One property's recorded vendor section, read through the invoker wrapper so RLS decides
// every row: a property the caller cannot read returns nothing rather than a denial shape.
export async function propertyVendors(
  context: RouteContext,
  propertyId: string,
): Promise<{ vendors: VendorLink[] }> {
  if (!uuid(propertyId)) throw new ApiError(400, 'invalid-input');
  const { data, error } = await context.client.rpc('list_property_vendors', {
    p_property_id: propertyId,
  });
  if (error) databaseError(error);
  try {
    return { vendors: vendorLinkRows(data ?? []) };
  } catch (failure) {
    if (failure instanceof VendorLinkError)
      throw new ApiError(503, 'unavailable');
    throw failure;
  }
}

// A link is a vendor-maintenance write (C5) on a property the caller may maintain; the
// database re-reads the live role, the maintenance gate and the parent property revision
// independently, and a duplicate submission converges on the recorded relationship.
export async function linkPropertyVendor(
  context: RouteContext,
  propertyId: string,
  body: Record<string, unknown>,
): Promise<VendorLink> {
  if (!uuid(propertyId)) throw new ApiError(400, 'invalid-input');
  let draft;
  try {
    draft = vendorLinkBody(body);
  } catch (failure) {
    if (failure instanceof VendorLinkError)
      throw new ApiError(400, 'invalid-input');
    throw failure;
  }
  const { data, error } = await context.client.rpc('link_property_vendor', {
    p_property_id: propertyId,
    p_vendor_id: draft.vendorId,
    p_expected_property_revision: draft.propertyRevision,
  });
  linkError(error);
  return linkOr503(data, draft.vendorId);
}

// Unlink removes only the current relationship; the vendor, its other links and the
// earlier property history stay. The link revision is the one the caller actually read.
export async function unlinkPropertyVendor(
  context: RouteContext,
  propertyId: string,
  vendorId: string,
  body: Record<string, unknown>,
): Promise<{ vendorId: string }> {
  if (!uuid(propertyId) || !uuid(vendorId))
    throw new ApiError(400, 'invalid-input');
  let draft;
  try {
    draft = vendorUnlinkBody(body);
  } catch (failure) {
    if (failure instanceof VendorLinkError)
      throw new ApiError(400, 'invalid-input');
    throw failure;
  }
  const { error } = await context.client.rpc('unlink_property_vendor', {
    p_property_id: propertyId,
    p_vendor_id: vendorId,
    p_expected_link_revision: draft.revision,
  });
  linkError(error);
  return { vendorId };
}

function linkError(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === '42501') throw new ApiError(403, 'access-denied');
  if (error.code === '40001') throw new ApiError(409, 'stale-edit');
  if (error.code === '23505') throw new ApiError(409, 'conflict');
  if (error.code === '23503' || error.code === 'P0002')
    throw new ApiError(404, 'not-found');
  if (error.code === '23514') throw new ApiError(400, 'invalid-input');
  databaseError(error);
}

// A confirmed link reads back through the same recorded projection the section renders, so
// a convergent duplicate returns the relationship that is actually recorded. The guarded
// operation already refused anything outside the bounded company shape.
function linkOr503(row: unknown, vendorId: string): VendorLink {
  let link;
  try {
    link = vendorLinkRecord(row);
  } catch (failure) {
    if (failure instanceof VendorLinkError)
      throw new ApiError(503, 'unavailable');
    throw failure;
  }
  if (link.vendorId !== vendorId) throw new ApiError(503, 'unavailable');
  return link;
}

// One guarded create behind the invoker wrapper. The actor, timestamp and submission key
// scope come from the session and the request; a same-key retry converges on the original
// company and a reused key with different details is a conflict.
export async function createVendor(
  context: RouteContext,
  body: Record<string, unknown>,
): Promise<Vendor> {
  let draft;
  try {
    draft = vendorDraft(body);
  } catch (failure) {
    throw new ApiError(
      400,
      failure instanceof VendorDraftError ? failure.code : 'invalid-input',
    );
  }
  const { data, error } = await context.client.rpc('create_vendor', {
    p_key: draft.key,
    p_display_name: draft.displayName,
    // Absent optional details use the database default (unknown, never an invented
    // value); the guard rejects anything present that is outside the bounded shape.
    ...(draft.contactName === null
      ? {}
      : { p_contact_name: draft.contactName }),
    ...(draft.phones === null ? {} : { p_phones: draft.phones }),
    ...(draft.email === null ? {} : { p_email: draft.email }),
    ...(draft.sourceAddress === null
      ? {}
      : { p_source_address: draft.sourceAddress }),
    ...(draft.notes === null ? {} : { p_notes: draft.notes }),
  });
  if (error) {
    if (error.code === '42501') throw new ApiError(403, 'access-denied');
    if (error.code === '23505') throw new ApiError(409, 'vendor-conflict');
    if (error.code === '23514') throw new ApiError(400, 'invalid-input');
    databaseError(error);
  }
  return recordOr503(data);
}

// The create route re-states the C5 rule before the RPC so a refused role is a session
// denial with the established 403 contract; the database enforces it independently.
export function assertVendorMaintainer(role: string) {
  if (!mayMaintainVendors(role)) throw new ApiError(403, 'access-denied');
}
