// One upload from the quick view: the same path the full workspace runs — register, PUT the bytes
// to the signed URL, read back what the store actually holds, then validate and complete — with
// the same per-class size limits and the same permitted formats. It is compact because the drawer
// has one file at a time and no need to resume a registration; what it keeps is the order that
// makes a lost response safe to look at rather than to assume.
import { fileClass, sizeRefusal } from './limits.ts';

// The category a quick upload lands in: the built-in "other" category, the same one the workspace
// offers as its default.
export const QUICK_UPLOAD_CATEGORY_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

export type QuickUploadRegistration = {
  fileId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  purpose: 'photo' | 'document';
  categoryId: string;
};

export type QuickUploadRegistrationResult = {
  uploadUrl: string;
  uploadBytes: number;
};

export type QuickUploadStored = {
  file: { upload_status: string; validated_object_id: string | null };
  objectState: 'absent' | 'present' | 'unknown' | 'unusable';
  error?: string;
};

export type QuickUploadTransport = {
  register: (
    registration: QuickUploadRegistration,
  ) => Promise<QuickUploadRegistrationResult>;
  put: (url: string, file: File, mimeType: string) => Promise<void>;
  recovery: (fileId: string) => Promise<{ uploads: QuickUploadStored[] }>;
  complete: (fileId: string) => Promise<void>;
};

export type QuickUploadProgress =
  'registering' | 'uploading' | 'validating' | 'done';

export type QuickUploadOutcome =
  | { ok: true; fileId: string; purpose: 'photo' | 'document' }
  | { ok: false; code: string; status: number | null };

// The purpose follows the same class the limits follow: an image is a property photo, everything
// else the path accepts is a document. The uploader never picks a purpose the bytes disagree with.
export function quickUploadPurpose(
  mimeType: string,
): 'photo' | 'document' | null {
  const kind = fileClass(mimeType);
  if (kind === null) return null;
  return kind === 'image' ? 'photo' : 'document';
}

// One file through the path. Every failure is reported as a code rather than thrown, so the
// drawer renders one row's state and one message without a try/catch of its own.
export async function quickUpload({
  file,
  transport,
  uuid = () => crypto.randomUUID(),
  onProgress,
}: {
  file: File;
  transport: QuickUploadTransport;
  uuid?: () => string;
  onProgress?: (progress: QuickUploadProgress) => void;
}): Promise<QuickUploadOutcome> {
  const purpose = quickUploadPurpose(file.type);
  if (purpose === null)
    return { ok: false, code: 'unsupported-format', status: null };
  if (file.size <= 0) return { ok: false, code: 'empty-file', status: null };
  const kind = fileClass(file.type)!;
  const refusal = sizeRefusal(kind, file.size);
  if (refusal) return { ok: false, code: refusal, status: null };
  const fileId = uuid();
  try {
    const sha256 = await digest(file);
    onProgress?.('registering');
    const registration = await transport.register({
      fileId,
      originalFilename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      sha256,
      purpose,
      categoryId: QUICK_UPLOAD_CATEGORY_ID,
    });
    if (registration.uploadBytes !== file.size)
      return { ok: false, code: 'file-mismatch', status: null };
    onProgress?.('uploading');
    await transport.put(registration.uploadUrl, file, file.type);
    // A response lost on the way back never establishes whether the store accepted the bytes, so
    // the store is asked rather than the answer assumed.
    const stored = await transport.recovery(fileId);
    const current = stored.uploads[0];
    if (!current) return { ok: false, code: 'not-found', status: null };
    if (
      current.file.upload_status === 'ready' &&
      current.file.validated_object_id
    ) {
      onProgress?.('done');
      return { ok: true, fileId, purpose };
    }
    if (current.objectState !== 'present')
      return {
        ok: false,
        code:
          current.error ??
          (current.objectState === 'absent'
            ? 'missing-bytes'
            : 'unknown-object-state'),
        status: null,
      };
    onProgress?.('validating');
    try {
      await transport.complete(fileId);
    } catch (failure) {
      // Completion may have committed before its own response was lost, so the store decides
      // whether the file is done or the failure is real.
      const after = await transport.recovery(fileId).catch(() => null);
      const saved = after?.uploads[0];
      if (
        saved?.file.upload_status !== 'ready' ||
        !saved.file.validated_object_id
      )
        return {
          ok: false,
          code: failureCode(failure),
          status: failureStatus(failure),
        };
    }
    onProgress?.('done');
    return { ok: true, fileId, purpose };
  } catch (failure) {
    return {
      ok: false,
      code: failureCode(failure),
      status: failureStatus(failure),
    };
  }
}

// The digest the registration pins: the content's own SHA-256, so the bytes uploaded are provably
// the bytes registered.
async function digest(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let text = '';
  for (const byte of digest) text += byte.toString(16).padStart(2, '0');
  return text;
}

function failureCode(failure: unknown): string {
  const code = (failure as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code !== '' ? code : 'unavailable';
}

function failureStatus(failure: unknown): number | null {
  const status = (failure as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}
