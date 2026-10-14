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
import type { Vendor, VendorPage } from './types';

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
// identifier from the caller other than the bounded UUID.
export async function vendorDetail(
  context: RouteContext,
  id: string,
): Promise<Vendor> {
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
  return recordOr503(data);
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
