import 'server-only';
import { ApiError, uuid } from '@/lib/supabase/route';
import type { RouteContext } from '@/lib/supabase/route';
import { deleteObject, storedObject } from '@/lib/r2';
import {
  discardExpiredRegistration,
  expiredPendingRegistration,
  type CleanupStore,
} from './upload-cleanup';
import type { FileRecoveryList, RecoverableFile } from './types';

const cleanup: CleanupStore = {
  remove: deleteObject,
  log: (message) => console.error(message),
};

export async function recoverFiles(
  context: RouteContext,
  propertyId: string,
  employeeId: string,
  fileId: string | null,
): Promise<FileRecoveryList> {
  if (!uuid(propertyId) || (fileId !== null && !uuid(fileId)))
    throw new ApiError(400, 'invalid-input');
  const { data: property, error: propertyError } = await context.client
    .from('properties')
    .select('id,archived_at')
    .eq('id', propertyId)
    .maybeSingle();
  if (propertyError) throw new ApiError(503, 'unavailable');
  if (!property || property.archived_at)
    throw new ApiError(403, 'access-denied');
  let query = context.client
    .from('property_files')
    .select(
      'id,property_id,document_type,category_id,purpose,object_path,original_filename,mime_type,size_bytes,sha256,upload_status,uploaded_by,created_at,validated_at,validated_object_id',
    )
    .eq('property_id', propertyId)
    .eq('uploaded_by', employeeId);
  query = fileId
    ? query.eq('id', fileId)
    : query.in('upload_status', ['pending', 'failed', 'cleanup_pending']);
  const { data: files, error } = await query.order('created_at', {
    ascending: false,
  });
  if (error) throw new ApiError(503, 'unavailable');
  if (fileId && !files?.length) throw new ApiError(404, 'not-found');
  const uploads: RecoverableFile[] = [];
  const now = Date.now();
  for (const file of files ?? []) {
    // A released registration can never become readable again; its bytes are deleted by the
    // server-side cleanup pass, which retries them until the deletion succeeds.
    if (
      file.upload_status === 'cleanup_pending' ||
      file.upload_status === 'failed' ||
      !file.mime_type ||
      !file.size_bytes ||
      !file.sha256
    ) {
      uploads.push({
        file,
        objectState: 'unusable',
        error: 'replacement-required',
      });
      continue;
    }
    // The list is the only enumeration of this employee's unfinished uploads, so it is where
    // an expired registration's bytes are discarded; its row stays for matching reselection.
    if (fileId === null && expiredPendingRegistration(file, now)) {
      const discarded = await discardExpiredRegistration(
        cleanup,
        file.object_path,
      );
      uploads.push(
        discarded === 'absent'
          ? { file, objectState: 'absent' }
          : { file, objectState: 'unknown', error: 'unknown-object-state' },
      );
      continue;
    }
    // An unreachable or unconfigured store stays 'unknown', never 'absent': bytes must not
    // be uploaded again over an object that may already be there.
    let object: Awaited<ReturnType<typeof storedObject>>;
    try {
      object = await storedObject(file.object_path);
    } catch {
      uploads.push({
        file,
        objectState: 'unknown',
        error: 'unknown-object-state',
      });
      continue;
    }
    uploads.push(
      object
        ? { file, objectState: 'present' }
        : { file, objectState: 'absent' },
    );
  }
  return { uploads };
}
