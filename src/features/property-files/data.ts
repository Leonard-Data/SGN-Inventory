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
      'id,property_id,document_type,purpose,category_id,object_path,original_filename,mime_type,size_bytes,sha256,upload_status,review_status,uploaded_by,created_at',
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

  // 1. Authorize read via RPC — raises 42501 if denied
  const { data: meta, error: authError } = await context.client
    .rpc('authorize_file_read', { p_file_id: fileId });
  if (authError) {
    if (authError.code === '42501') throw new ApiError(403, 'access-denied');
    throw new ApiError(503, 'unavailable');
  }
  if (!meta || typeof meta !== 'object' || !('object_path' in (meta as Record<string, unknown>)))
    throw new ApiError(403, 'access-denied');

  const path = (meta as Record<string, string>).object_path;

  // 2. Create signed URL (60 seconds, as recommended)
  const { data: signed, error: signError } = await context.client
    .storage
    .from('property-files')
    .createSignedUrl(path, 60, { download: download ? undefined : undefined });

  if (signError || !signed) throw new ApiError(503, 'unavailable');

  return {
    url: signed.signedUrl,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  };
}
