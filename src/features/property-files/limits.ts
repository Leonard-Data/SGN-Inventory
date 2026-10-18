// Per-property attachment limits. The class comes from the validated content type, never
// from the uploader's chosen purpose or category: a PDF is a document, JPEG/PNG/WebP are images.
export type FileClass = 'document' | 'image';

export const fileLimits: Record<
  FileClass,
  { maximumBytes: number; maximumCount: number }
> = {
  document: { maximumBytes: 20 * 1024 * 1024, maximumCount: 5 },
  image: { maximumBytes: 5 * 1024 * 1024, maximumCount: 10 },
};

export function fileClass(mimeType: string): FileClass | null {
  if (mimeType === 'application/pdf') return 'document';
  if (['image/jpeg', 'image/png', 'image/webp'].includes(mimeType))
    return 'image';
  return null;
}

// Localized refusal codes; null means the attachment fits its class limit.
export function sizeRefusal(kind: FileClass, sizeBytes: number): string | null {
  if (sizeBytes <= fileLimits[kind].maximumBytes) return null;
  return kind === 'document' ? 'file-too-large' : 'image-too-large';
}

export function countRefusal(
  kind: FileClass,
  existingCount: number,
): string | null {
  if (existingCount < fileLimits[kind].maximumCount) return null;
  return kind === 'document' ? 'document-limit' : 'image-limit';
}
