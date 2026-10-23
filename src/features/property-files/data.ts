import 'server-only';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import { presignDownload, signedUrlSeconds } from '@/lib/r2';
import { signAuthorizedFile, type FileRead, type Lookup } from './read-path';
import type { PropertyFileList, SignedFileResponse } from './types';

export async function propertyFiles(
  context: RouteContext,
  propertyId: string,
): Promise<PropertyFileList> {
  if (!uuid(propertyId)) throw new ApiError(400, 'invalid-input');
  const { data: files, error } = await context.client
    .from('property_files')
    .select(
      'id,property_id,document_type,category_id,object_path,original_filename,mime_type,size_bytes,sha256,upload_status,purpose,uploaded_by,created_at,validated_at,validated_object_id',
    )
    .eq('property_id', propertyId)
    .eq('upload_status', 'ready')
    .order('created_at', { ascending: false });
  if (error)
    throw new ApiError(
      error.code === '42501' ? 403 : 503,
      error.code === '42501' ? 'operation-refused' : 'unavailable',
    );
  return { files: files ?? [] };
}
export async function authorizeAndSignFile(
  context: RouteContext,
  propertyId: string,
  fileId: string,
  download: boolean,
): Promise<SignedFileResponse> {
  if (!uuid(propertyId) || !uuid(fileId))
    throw new ApiError(400, 'invalid-input');
  if (typeof download !== 'boolean') throw new ApiError(400, 'invalid-input');

  // The two reads below run under the caller's session and inherit RLS, including the
  // archived-property reviewer boundary. Only their result can produce a URL.
  const outcome = await signAuthorizedFile(
    {
      readProperty: async (id) => {
        const { data: property, error } = await context.client
          .from('properties')
          .select('id')
          .eq('id', id)
          .maybeSingle();
        if (error)
          return {
            refused: error.code === '42501' ? 403 : 503,
          } satisfies Lookup<unknown>;
        return property
          ? { found: property }
          : ({ refused: 404 } satisfies Lookup<unknown>);
      },
      readFile: async (id, wantedFileId) => {
        const { data: file, error } = await context.client
          .from('property_files')
          .select('id,object_path,original_filename')
          .eq('property_id', id)
          .eq('id', wantedFileId)
          .eq('upload_status', 'ready')
          .maybeSingle();
        if (error)
          return {
            refused: error.code === '42501' ? 403 : 503,
          } satisfies Lookup<FileRead>;
        return file
          ? {
              found: {
                objectPath: file.object_path,
                originalFilename: file.original_filename,
              },
            }
          : ({ refused: 404 } satisfies Lookup<FileRead>);
      },
      presign: async (objectPath, originalFilename) => ({
        url: await presignDownload(objectPath, originalFilename),
        expiresIn: signedUrlSeconds,
      }),
      now: Date.now,
    },
    { propertyId, fileId, download },
  );
  if (outcome.status !== 'signed')
    throw new ApiError(outcome.status, outcome.code);
  return { url: outcome.url, expiresAt: outcome.expiresAt };
}
