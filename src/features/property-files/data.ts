import 'server-only';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import type { PropertyFileList, SignedFileResponse } from './types';

export async function propertyFiles(
  context: RouteContext,
  propertyId: string,
): Promise<PropertyFileList> {
  if (!uuid(propertyId)) throw new ApiError(400, 'invalid-input');
  const { data: files, error } = await context.client
    .from('property_files')
    .select(
      'id,property_id,document_type,object_path,original_filename,mime_type,size_bytes,sha256,upload_status,uploaded_by,created_at',
    )
    .eq('property_id', propertyId)
    .eq('upload_status', 'ready')
    .order('created_at', { ascending: false });
  if (error)
    throw new ApiError(
      error.code === '42501' ? 403 : 503,
      error.code === '42501' ? 'access-denied' : 'unavailable',
    );
  return { files: files ?? [] };
}
export async function authorizeAndSignFile(
  context: RouteContext,
  propertyId: string,
  fileId: string,
  download: boolean,
): Promise<SignedFileResponse> {
  if (!uuid(propertyId) || !uuid(fileId)) throw new ApiError(400, 'invalid-input');
  if (typeof download !== 'boolean') throw new ApiError(400, 'invalid-input');

  // Verify property exists and caller has access (RLS on properties table)
  const { data: property, error: propError } = await context.client
    .from('properties')
    .select('id')
    .eq('id', propertyId)
    .maybeSingle();
  if (propError) {
    if (propError.code === '42501') throw new ApiError(403, 'access-denied');
    throw new ApiError(503, 'unavailable');
  }
  if (!property) throw new ApiError(404, 'not-found');

  // Verify file exists, belongs to property, is ready — RLS ensures caller has access
  const { data: file, error: fileError } = await context.client
    .from('property_files')
    .select('id,object_path,original_filename')
    .eq('property_id', propertyId)
    .eq('id', fileId)
    .eq('upload_status', 'ready')
    .maybeSingle();
  if (fileError) {
    if (fileError.code === '42501') throw new ApiError(403, 'access-denied');
    throw new ApiError(503, 'unavailable');
  }
  if (!file) throw new ApiError(404, 'not-found');

  // Create signed URL (60 seconds)
  const { data: signed, error: signError } = await context.client
    .storage
    .from('property-files')
    .createSignedUrl(file.object_path, 60, { download: download ? file.original_filename : undefined });

  if (signError || !signed) throw new ApiError(503, 'unavailable');

  return {
    url: signed.signedUrl,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  };
}
