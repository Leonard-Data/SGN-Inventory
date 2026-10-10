import type { Database } from '@/types/database';

export type DocumentCategory = {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
};

export type PropertyFile = Pick<
  Database['public']['Tables']['property_files']['Row'],
  | 'id'
  | 'property_id'
  | 'document_type'
  | 'category_id'
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
export type DocumentCategoryList = { categories: DocumentCategory[] };
export type SignedFileResponse = { url: string; expiresAt: number };
export type FileRegistrationResult = {
  fileId: string;
  objectPath: string;
  uploadUrl: string;
  publishableKey: string;
  accessToken: string;
};
export type RecoverableFile = {
  file: PropertyFile;
  objectState: 'absent' | 'present' | 'unknown' | 'unusable';
  error?: string;
};
export type FileRecoveryList = { uploads: RecoverableFile[] };
