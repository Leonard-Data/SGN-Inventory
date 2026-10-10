import 'server-only';
import { createHash, createHmac } from 'node:crypto';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import { contentMime, fileMimeTypes, maximumFileBytes } from './content';
import type { DocumentCategoryList, FileRegistrationResult } from './types';
import type { Employee } from '@/features/employees/types';

function databaseFailure(error: { code?: string }): never {
  if (error.code === '42501') throw new ApiError(403, 'access-denied');
  if (error.code === '23514' || error.code === '22P02')
    throw new ApiError(400, 'invalid-input');
  if (error.code === '23505') throw new ApiError(409, 'file-conflict');
  throw new ApiError(503, 'unavailable');
}

export async function registerFile(
  context: RouteContext,
  propertyId: string,
  body: Record<string, unknown>,
): Promise<FileRegistrationResult> {
  if (
    !uuid(propertyId) ||
    !uuid(body.fileId) ||
    Object.keys(body).some(
      (key) =>
        ![
          'fileId',
          'originalFilename',
          'mimeType',
          'sizeBytes',
          'sha256',
          'purpose',
          'categoryId',
        ].includes(key),
    )
  )
    throw new ApiError(400, 'invalid-input');
  if (
    typeof body.originalFilename !== 'string' ||
    !body.originalFilename.trim() ||
    new TextEncoder().encode(body.originalFilename).length > 255 ||
    /[\u0000-\u001f\u007f/\\<>:"|?*]/.test(body.originalFilename) ||
    ['.', '..'].includes(body.originalFilename)
  )
    throw new ApiError(400, 'unsafe-filename');
  if (
    typeof body.mimeType !== 'string' ||
    !fileMimeTypes.some((type) => type === body.mimeType)
  )
    throw new ApiError(400, 'unsupported-format');
  if (
    typeof body.sizeBytes !== 'number' ||
    !Number.isSafeInteger(body.sizeBytes)
  )
    throw new ApiError(400, 'invalid-input');
  if (body.sizeBytes <= 0) throw new ApiError(400, 'empty-file');
  if (body.sizeBytes > maximumFileBytes)
    throw new ApiError(400, 'file-too-large');
  if (
    typeof body.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(body.sha256) ||
    (body.purpose !== 'document' && body.purpose !== 'photo') ||
    (body.purpose === 'photo' && body.mimeType === 'application/pdf')
  )
    throw new ApiError(400, 'invalid-input');
  if (
    body.categoryId !== undefined &&
    body.categoryId !== null &&
    !uuid(body.categoryId)
  )
    throw new ApiError(400, 'invalid-input');
  const { data, error } = await context.client.rpc('register_property_file', {
    p_file_id: body.fileId,
    p_property_id: propertyId,
    p_original_filename: body.originalFilename,
    p_mime_type: body.mimeType,
    p_size_bytes: body.sizeBytes,
    p_sha256: body.sha256,
    p_purpose: body.purpose,
    p_category_id: typeof body.categoryId === 'string' ? body.categoryId : undefined,
  });
  if (error) databaseFailure(error);
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    !uuid(data.fileId) ||
    typeof data.objectPath !== 'string'
  )
    throw new ApiError(503, 'unavailable');
  // The route already validated the live employee; this session is transport only, never authorization.
  const {
    data: { session },
    error: sessionError,
  } = await context.client.auth.getSession();
  if (sessionError || !session) throw new ApiError(401, 'unauthenticated');
  return {
    fileId: data.fileId,
    objectPath: data.objectPath,
    uploadUrl:
      context.environment.supabaseUrl +
      '/storage/v1/object/property-files/' +
      data.objectPath.split('/').map(encodeURIComponent).join('/'),
    publishableKey: context.environment.publishableKey,
    accessToken: session.access_token,
  };
}

export async function validateAndCompleteFile(
  context: RouteContext,
  propertyId: string,
  fileId: string,
  employee: Employee,
) {
  if (!uuid(propertyId) || !uuid(fileId))
    throw new ApiError(400, 'invalid-input');
  const key = process.env.SGN_FILE_VALIDATION_KEY;
  if (!key || !/^[a-f0-9]{64}$/.test(key))
    throw new ApiError(503, 'unavailable');
  const { data: file, error } = await context.client
    .from('property_files')
    .select(
      'id,property_id,object_path,mime_type,size_bytes,sha256,uploaded_by,upload_status,purpose',
    )
    .eq('id', fileId)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!file) throw new ApiError(404, 'not-found');
  const { data: property, error: propertyError } = await context.client
    .from('properties')
    .select('id,archived_at,created_by')
    .eq('id', propertyId)
    .maybeSingle();
  if (propertyError) databaseFailure(propertyError);
  if (!property || property.archived_at)
    throw new ApiError(403, 'access-denied');
  const readyPhotoEditor =
    file.upload_status === 'ready' &&
    file.purpose === 'photo' &&
    (property.created_by === employee.id ||
      ['staff', 'manager', 'admin'].includes(employee.role));
  if (file.uploaded_by !== employee.id && !readyPhotoEditor)
    throw new ApiError(403, 'access-denied');
  if (file.upload_status !== 'pending' && file.upload_status !== 'ready')
    throw new ApiError(400, 'invalid-file');
  const storage = context.client.storage.from('property-files');
  const { data: info, error: infoError } = await storage.info(file.object_path);
  if (infoError || !info) {
    if (
      infoError &&
      'statusCode' in infoError &&
      String(infoError.statusCode) === '404'
    )
      throw new ApiError(409, 'missing-bytes');
    throw new ApiError(503, 'unavailable');
  }
  if (!uuid(info.id)) throw new ApiError(503, 'unavailable');
  if (
    info.size !== undefined &&
    (info.size <= 0 ||
      info.size > maximumFileBytes ||
      (file.size_bytes !== null && info.size !== file.size_bytes))
  )
    throw new ApiError(400, 'file-mismatch');
  const { data: blob, error: downloadError } = await storage.download(
    file.object_path,
  );
  if (downloadError || !blob) throw new ApiError(503, 'unavailable');
  if (
    blob.size <= 0 ||
    blob.size > maximumFileBytes ||
    (file.size_bytes !== null && blob.size !== file.size_bytes)
  )
    throw new ApiError(400, 'file-mismatch');
  const bytes = Buffer.from(await blob.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (file.sha256 !== null && sha256 !== file.sha256)
    throw new ApiError(400, 'file-mismatch');
  let mimeType: string;
  try {
    mimeType = await contentMime(bytes);
  } catch {
    throw new ApiError(400, 'invalid-file');
  }
  if (
    (file.mime_type !== null && mimeType !== file.mime_type) ||
    (file.mime_type !== null && info.contentType && info.contentType.split(';')[0]?.trim() !== mimeType) ||
    (file.purpose === 'photo' && mimeType === 'application/pdf')
  )
    throw new ApiError(400, 'file-mismatch');
  const { data: currentInfo, error: currentError } = await storage.info(
    file.object_path,
  );
  if (currentError || !currentInfo) throw new ApiError(503, 'unavailable');
  if (currentInfo.id !== info.id || currentInfo.version !== info.version)
    throw new ApiError(409, 'file-conflict');
  const payload = [
    'v1',
    file.id,
    file.property_id,
    file.uploaded_by ?? '',
    file.object_path,
    info.id,
    mimeType,
    String(bytes.length),
    sha256,
  ].join('|');
  const signature = createHmac('sha256', Buffer.from(key, 'hex'))
    .update(payload)
    .digest('hex');
  const { error: completionError } = await context.client.rpc(
    'complete_property_upload',
    {
      p_file_id: file.id,
      p_object_id: info.id,
      p_mime_type: mimeType,
      p_size_bytes: bytes.length,
      p_sha256: sha256,
      p_signature: signature,
    },
  );
  if (completionError) databaseFailure(completionError);
  return { status: 'ready' as const };
}

export async function listCategories(
  context: RouteContext,
): Promise<DocumentCategoryList> {
  const { data, error } = await context.client.rpc('list_document_categories');
  if (error)
    throw new ApiError(
      error.code === '42501' ? 403 : 503,
      error.code === '42501' ? 'access-denied' : 'unavailable',
    );
  return { categories: data ?? [] };
}

export async function createOrGetCategory(
  context: RouteContext,
  name: string,
): Promise<string> {
  if (typeof name !== 'string' || !name.trim())
    throw new ApiError(400, 'invalid-input');
  const { data, error } = await context.client.rpc('create_or_get_category', {
    p_name: name.trim(),
  });
  if (error) databaseFailure(error);
  if (!data || typeof data !== 'string') throw new ApiError(503, 'unavailable');
  return data;
}
