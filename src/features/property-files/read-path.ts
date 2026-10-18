import type { SignedFileResponse } from './types';

export type FileRead = {
  objectPath: string;
  originalFilename: string;
};

export type Lookup<T> = { found: T } | { refused: 403 | 404 | 503 };

// Every lookup is the caller's own RLS-scoped read, so this module decides no access itself;
// it only orders the reads and refuses before any URL exists.
export type FileSigning = {
  readProperty: (propertyId: string) => Promise<Lookup<unknown>>;
  readFile: (propertyId: string, fileId: string) => Promise<Lookup<FileRead>>;
  // The signer reports the lifetime it actually used, so the returned expiry can never drift
  // from the URL it describes.
  presign: (
    objectPath: string,
    originalFilename?: string,
  ) => Promise<{ url: string; expiresIn: number }>;
  now: () => number;
};

export type SignOutcome =
  | ({ status: 'signed' } & SignedFileResponse)
  | { status: 400 | 403 | 404 | 503; code: string };

function refusal(status: 403 | 404 | 503): SignOutcome {
  return {
    status,
    code:
      status === 403
        ? 'access-denied'
        : status === 404
          ? 'not-found'
          : 'unavailable',
  };
}

// The database row stays the read authority: the property and file records are read under
// the caller's session first, and only a readable completed file earns a short-lived URL.
// An archived property reached by a non-reviewer is hidden by that read, as before.
export async function signAuthorizedFile(
  signing: FileSigning,
  request: { propertyId: string; fileId: string; download: boolean },
): Promise<SignOutcome> {
  const property = await signing.readProperty(request.propertyId);
  if ('refused' in property) return refusal(property.refused);
  const file = await signing.readFile(request.propertyId, request.fileId);
  if ('refused' in file) return refusal(file.refused);
  const signed = await signing.presign(
    file.found.objectPath,
    request.download ? file.found.originalFilename : undefined,
  );
  return {
    status: 'signed',
    url: signed.url,
    expiresAt: Math.floor(signing.now() / 1000) + signed.expiresIn,
  };
}
