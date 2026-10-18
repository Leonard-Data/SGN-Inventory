import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type UploadSignature = { url: string; contentLength: number };

export type UploadSignatureRequest = {
  bucket: string;
  objectPath: string;
  contentType: string;
  contentLength: number;
  expiresIn: number;
};

// The browser writes straight into the private bucket, so the signed request carries both
// write controls, and R2 enforces them itself: the exact byte count and the conditional
// create, which is what makes an existing object unoverwritable.
export async function presignedUploadPut(
  client: S3Client,
  request: UploadSignatureRequest,
): Promise<UploadSignature> {
  const url = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: request.bucket,
      Key: request.objectPath,
      ContentType: request.contentType,
      ContentLength: request.contentLength,
      IfNoneMatch: '*',
    }),
    {
      expiresIn: request.expiresIn,
      signableHeaders: new Set(['content-length', 'if-none-match']),
    },
  );
  return { url, contentLength: request.contentLength };
}
