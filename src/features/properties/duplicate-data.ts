import 'server-only';
import { createHmac } from 'node:crypto';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import { copyObject, objectIdentity, storedObject } from '@/lib/r2';
import { mergeLimit, mergeRequest, movedObjectPath } from './merge-rules';
import type { AddressGroup, MergeReport } from './types';

// The signed-in employee's read of one address group. The database decides membership on the
// recorded address text and returns an empty group for a unique address or an archived record.
export async function addressGroup(
  context: RouteContext,
  id: string,
): Promise<AddressGroup> {
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  const { data, error } = await context.client.rpc('property_address_group', {
    p_property_id: id,
  });
  if (error) return denied(error);
  return data as AddressGroup;
}

function denied(error: { code?: string }): never {
  throw error.code === '42501'
    ? new ApiError(403, 'access-denied')
    : new ApiError(503, 'unavailable');
}

type PendingBlocker = { propertyCode: string; requester: string };

// Only the records and requesters the merge itself named are forwarded to the browser, never
// the raw database detail.
function namedBlockers(details: string | undefined): PendingBlocker[] {
  if (!details) return [];
  try {
    const parsed: unknown = JSON.parse(details);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is PendingBlocker =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as PendingBlocker).propertyCode === 'string' &&
        typeof (row as PendingBlocker).requester === 'string',
    );
  } catch {
    return [];
  }
}

// Every refusal the merge can name, so the browser reports the cause instead of a generic
// failure. An unrecognized failure (a lost response, an outage) stays a 503.
function mergeRefusal(error: {
  code?: string;
  details?: string;
}): ApiError | null {
  if (error.code === '42501') return new ApiError(403, 'access-denied');
  if (error.code === 'P0002') return new ApiError(404, 'not-found');
  if (error.code === 'P0008') return new ApiError(409, 'merge-target');
  if (error.code === 'P0009') return new ApiError(409, 'address-mismatch');
  if (error.code === 'P0014') return new ApiError(409, 'reservation-conflict');
  if (error.code === 'P0015') return new ApiError(409, 'rental-active');
  if (error.code === 'P0016' || error.code === 'P0018')
    return new ApiError(409, 'file-move-incomplete');
  if (error.code === 'P0017') return new ApiError(409, 'merge-archived');
  if (error.code === 'P0019')
    return new ApiError(
      409,
      'pending-reservation',
      namedBlockers(error.details),
    );
  if (error.code === '23505') return new ApiError(409, 'merge-conflict');
  if (error.code === '23514') return new ApiError(400, 'invalid-input');
  return null;
}

type ReadyFile = { id: string; property_id: string; object_path: string };
type MovedFile = { id: string; path: string; objectId: string };

// The destination object's identity is the server's evidence that the copied bytes exist; the
// database refuses any move its own key has not signed.
async function attestedCopy(from: string, to: string): Promise<string> {
  await copyObject(from, to);
  const info = await storedObject(to);
  if (!info) throw new ApiError(503, 'unavailable');
  return objectIdentity(info.etag);
}

// A deliberate, role-checked merge: the bytes of every ready file are copied to the survivor's
// key and attested first, and only then does the database move the records in one transaction.
// Copies are never deleted: a concurrent merge can already reference those keys, and a copy left
// behind carries no file record, so no read can reach it.
export async function mergeDuplicates(
  context: RouteContext,
  id: string,
  body: Record<string, unknown>,
): Promise<MergeReport> {
  if (Array.isArray(body.merge) && body.merge.length > mergeLimit)
    throw new ApiError(400, 'merge-too-large');
  const request = mergeRequest(id, body);
  if (!request) throw new ApiError(400, 'invalid-input');
  const merge = request.merge;

  const { data: files, error } = await context.client
    .from('property_files')
    .select('id,property_id,object_path')
    .in('property_id', merge)
    .eq('upload_status', 'ready')
    .order('id');
  if (error) denied(error);
  const moving = (files ?? []) as ReadyFile[];
  const moved: MovedFile[] = [];
  for (const file of moving) {
    const to = movedObjectPath(id, {
      id: file.id,
      propertyId: file.property_id,
      objectPath: file.object_path,
    });
    if (!to) throw new ApiError(409, 'file-move-incomplete');
    moved.push({
      id: file.id,
      path: to,
      objectId: await attestedCopy(file.object_path, to),
    });
  }

  let signature: string | null = null;
  if (moved.length) {
    const key = process.env.SGN_FILE_VALIDATION_KEY;
    if (!key || !/^[a-f0-9]{64}$/.test(key))
      throw new ApiError(503, 'unavailable');
    const payload = [
      'v1',
      'merge',
      id,
      ...moved.flatMap((file) => [file.id, file.path, file.objectId]),
    ].join('|');
    signature = createHmac('sha256', Buffer.from(key, 'hex'))
      .update(payload)
      .digest('hex');
  }

  const { data: report, error: mergeFailure } = await context.client.rpc(
    'merge_address_properties',
    {
      p_keep_property_id: id,
      p_merge_property_ids: merge,
      p_moved_object_ids: moved.map((file) => file.objectId),
      p_move_signature: signature,
    },
  );
  if (mergeFailure) {
    const refusal = mergeRefusal(mergeFailure);
    throw refusal ?? new ApiError(503, 'unavailable');
  }
  return report as MergeReport;
}
