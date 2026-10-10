import 'server-only';
import { ApiError, uuid } from '@/lib/supabase/route';
import type { RouteContext } from '@/lib/supabase/route';
import type { FileRecoveryList, RecoverableFile } from './types';

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
    : query.in('upload_status', ['pending', 'failed']);
  const { data: files, error } = await query.order('created_at', {
    ascending: false,
  });
  if (error) throw new ApiError(503, 'unavailable');
  if (fileId && !files?.length) throw new ApiError(404, 'not-found');
  const uploads: RecoverableFile[] = [];
  for (const file of files ?? []) {
    if (
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
    const { data: info, error: infoError } = await context.client.storage
      .from('property-files')
      .info(file.object_path);
    if (info) uploads.push({ file, objectState: 'present' });
    else if (
      infoError &&
      (infoError.statusCode === '404' ||
        infoError.message === 'Object not found')
    )
      uploads.push({ file, objectState: 'absent' });
    else if (infoError?.message.startsWith('Invalid key:'))
      uploads.push({
        file,
        objectState: 'unusable',
        error: 'replacement-required',
      });
    else
      uploads.push({
        file,
        objectState: 'unknown',
        error: 'unknown-object-state',
      });
  }
  return { uploads };
}
