import 'server-only';
import { createHash, createHmac } from 'node:crypto';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import {
  objectIdentity,
  presignUpload,
  storedBytes,
  storedObject,
} from '@/lib/r2';
import { contentMime, fileMimeTypes, maximumFileBytes } from './content';
import { fileClass, sizeRefusal } from './limits';
import type { DocumentCategoryList, FileRegistrationResult } from './types';
import type { Employee } from '@/features/employees/types';

// SQLSTATEs the storage-limit migration raises; each refusal names the limit it hit.
const limitCodes: Record<string, string> = {
  P0020: 'document-limit',
  P0021: 'image-limit',
  P0022: 'image-too-large',
};

function databaseFailure(error: { code?: string }): never {
  const limit = error.code ? limitCodes[error.code] : undefined;
  if (error.code === '42501') throw new ApiError(403, 'access-denied');
  if (limit) throw new ApiError(400, limit);
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
  const kind = fileClass(body.mimeType);
  if (!kind) throw new ApiError(400, 'unsupported-format');
  const sizeRefused = sizeRefusal(kind, body.sizeBytes);
  if (sizeRefused) throw new ApiError(400, sizeRefused);
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
    p_category_id:
      typeof body.categoryId === 'string' ? body.categoryId : undefined,
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
  // The registration (and its property-scoped class limit) committed before any URL exists.
  // The browser then uploads the bytes straight to private R2; the server never sees them.
  return {
    fileId: data.fileId,
    objectPath: data.objectPath,
    uploadUrl: await presignUpload(data.objectPath, body.mimeType),
  };
}

export async function validateAndCompleteFile(
  context: RouteContext,
  propertyId: string,
  fileId: string,
  employee: Employee,
) {
  try {
    return await completeFile(context, propertyId, fileId, employee);
  } catch (error) {
    // A refused completion is terminal for these bytes, so the registration stops
    // reserving its class slot. Transient failures stay pending for a retry.
    if (error instanceof ApiError && error.status === 400)
      await context.client.rpc('fail_property_upload', { p_file_id: fileId });
    throw error;
  }
}

async function completeFile(
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
  const info = await storedObject(file.object_path);
  if (!info) throw new ApiError(409, 'missing-bytes');
  if (
    info.size <= 0 ||
    info.size > maximumFileBytes ||
    (file.size_bytes !== null && info.size !== file.size_bytes)
  )
    throw new ApiError(400, 'file-mismatch');
  const bytes = await storedBytes(file.object_path);
  if (
    bytes.length <= 0 ||
    bytes.length > maximumFileBytes ||
    (file.size_bytes !== null && bytes.length !== file.size_bytes)
  )
    throw new ApiError(400, 'file-mismatch');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (file.sha256 !== null && sha256 !== file.sha256)
    throw new ApiError(400, 'file-mismatch');
  let mimeType: string;
  try {
    mimeType = await contentMime(bytes);
  } catch {
    throw new ApiError(400, 'invalid-file');
  }
  // The class comes from the validated content, so the byte cap cannot be dodged by the
  // uploader's chosen purpose or category. The count cap is re-checked by the database.
  const kind = fileClass(mimeType);
  if (!kind) throw new ApiError(400, 'invalid-file');
  const sizeRefused = sizeRefusal(kind, bytes.length);
  if (sizeRefused) throw new ApiError(400, sizeRefused);
  if (
    (file.mime_type !== null && mimeType !== file.mime_type) ||
    (file.mime_type !== null &&
      info.contentType &&
      info.contentType.split(';')[0]?.trim() !== mimeType) ||
    (file.purpose === 'photo' && mimeType === 'application/pdf')
  )
    throw new ApiError(400, 'file-mismatch');
  const currentInfo = await storedObject(file.object_path);
  if (!currentInfo) throw new ApiError(503, 'unavailable');
  if (currentInfo.etag !== info.etag) throw new ApiError(409, 'file-conflict');
  const objectId = objectIdentity(info.etag);
  const payload = [
    'v1',
    file.id,
    file.property_id,
    file.uploaded_by ?? '',
    file.object_path,
    objectId,
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
      p_object_id: objectId,
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
