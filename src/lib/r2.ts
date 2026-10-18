import 'server-only';
import { createHash } from 'node:crypto';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Bearer links stay as short as the previous Storage signed URLs.
export const signedUrlSeconds = 60;

let cached: { bucket: string; client: S3Client } | null = null;

// Server-only configuration. Never falls back to Supabase Storage: a missing value must
// stop the operation rather than silently write to the wrong place.
function storage(): { bucket: string; client: S3Client } {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey)
    throw new Error(
      'R2 storage is not configured: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required server-only variables',
    );
  cached ??= {
    bucket,
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
  return cached;
}

// R2 reports one ETag per object version. The database evidence column is a UUID, so the
// object identity recorded at completion is a stable UUID derived from that ETag: changed
// bytes change the identity, and a repeated completion of the same object converges.
export function objectIdentity(etag: string): string {
  const hex = createHash('md5').update(etag).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export async function presignUpload(
  objectPath: string,
  contentType: string,
): Promise<string> {
  const { bucket, client } = storage();
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectPath,
      ContentType: contentType,
    }),
    { expiresIn: signedUrlSeconds },
  );
}

export async function presignDownload(
  objectPath: string,
  originalFilename?: string,
): Promise<string> {
  const { bucket, client } = storage();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectPath,
      ResponseContentDisposition: originalFilename
        ? disposition(originalFilename)
        : undefined,
    }),
    { expiresIn: signedUrlSeconds },
  );
}

// Vietnamese filenames survive both the plain and the RFC 5987 parameter.
function disposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export type StoredObject = {
  etag: string;
  size: number;
  contentType: string | null;
};

function absent(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'NotFound' ||
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404)
  );
}

// null means R2 answered that no object exists at this key; any other failure throws, so
// callers can never mistake an outage or missing configuration for absent bytes.
export async function storedObject(
  objectPath: string,
): Promise<StoredObject | null> {
  const { bucket, client } = storage();
  try {
    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: objectPath }),
    );
    if (!head.ETag) throw new Error('R2 object has no ETag');
    return {
      etag: head.ETag,
      size: head.ContentLength ?? 0,
      contentType: head.ContentType ?? null,
    };
  } catch (error) {
    if (absent(error)) return null;
    throw error;
  }
}

export async function storedBytes(objectPath: string): Promise<Buffer> {
  const { bucket, client } = storage();
  const object = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: objectPath }),
  );
  if (!object.Body) throw new Error('R2 object response carried no body');
  return Buffer.from(await object.Body.transformToByteArray());
}
