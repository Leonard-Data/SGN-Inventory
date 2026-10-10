export type PropertyFile = {
  id: string;
  property_id: string;
  document_type: string;
  object_path: string;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  upload_status: string;
  uploaded_by: string | null;
  created_at: string;
};

export type PropertyFileList = {
  files: PropertyFile[];
};

export type SignedFileResponse = {
  url: string;
  expiresAt: number;
};
