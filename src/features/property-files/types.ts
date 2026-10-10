import type { Database } from '@/types/database';

export type PropertyFile = Pick<
  Database['public']['Tables']['property_files']['Row'],
  | 'id'
  | 'property_id'
  | 'document_type'
  | 'purpose'
  | 'object_path'
  | 'original_filename'
  | 'mime_type'
  | 'size_bytes'
  | 'sha256'
  | 'upload_status'
  | 'uploaded_by'
  | 'created_at'
  | 'validated_at'
  | 'validated_object_id'
>;
export type PropertyFileList = { files: PropertyFile[] };
export type SignedFileResponse = { url: string; expiresAt: number };
export type FileRegistrationResult = {
  fileId: string;
  objectPath: string;
  uploadUrl: string;
  publishableKey: string;
  accessToken: string;
};
