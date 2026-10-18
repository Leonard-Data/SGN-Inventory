import 'server-only';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import { copyObject, deleteObject } from '@/lib/r2';
import { mergeRequest, movedObjectPath } from './merge-rules';
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

// Every refusal the merge can name, so the browser reports the cause instead of a generic
// failure. A database refusal is definite: the transaction rolled back, so nothing moved. An
// unrecognized failure (a lost response, an outage) is not, so it returns null and leaves the
// copies in place — an unreferenced copy is harmless, while deleting one the commit already
// points at would destroy a readable file.
function mergeRefusal(error: { code?: string }): ApiError | null {
  if (error.code === '42501') return new ApiError(403, 'access-denied');
  if (error.code === 'P0002') return new ApiError(404, 'not-found');
  if (error.code === 'P0008') return new ApiError(409, 'merge-target');
  if (error.code === 'P0009') return new ApiError(409, 'address-mismatch');
  if (error.code === 'P0014') return new ApiError(409, 'reservation-conflict');
  if (error.code === 'P0015') return new ApiError(409, 'rental-active');
  if (error.code === 'P0016') return new ApiError(409, 'file-move-incomplete');
  if (error.code === '23514') return new ApiError(400, 'invalid-input');
  return null;
}

type ReadyFile = { id: string; property_id: string; object_path: string };

// A copy left behind carries no file record, so no read can reach it, and a repeated merge
// overwrites the same key; a cleanup failure therefore needs no error of its own.
async function discard(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map((path) => deleteObject(path).catch(() => undefined)),
  );
}

// A deliberate, role-checked merge: the bytes of every ready file are copied to the survivor's
// key first, and only then does the database move the records in one transaction. If the merge
// is refused, the copies are removed so nothing is left half-moved.
export async function mergeDuplicates(
  context: RouteContext,
  id: string,
  body: Record<string, unknown>,
): Promise<MergeReport> {
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
  const copied: string[] = [];
  try {
    for (const file of moving) {
      const to = movedObjectPath(id, {
        id: file.id,
        propertyId: file.property_id,
        objectPath: file.object_path,
      });
      if (!to) throw new ApiError(409, 'file-move-incomplete');
      await copyObject(file.object_path, to);
      copied.push(to);
    }
  } catch (failure) {
    await discard(copied);
    if (failure instanceof ApiError) throw failure;
    denied({});
  }

  const { data: report, error: mergeFailure } = await context.client.rpc(
    'merge_address_properties',
    {
      p_keep_property_id: id,
      p_merge_property_ids: merge,
      p_moved_file_ids: moving.map((file) => file.id),
    },
  );
  if (mergeFailure) {
    const refusal = mergeRefusal(mergeFailure);
    if (!refusal) throw new ApiError(503, 'unavailable');
    await discard(copied);
    throw refusal;
  }
  return report as MergeReport;
}
