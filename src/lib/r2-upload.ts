import type { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';

export type UploadPolicy = { url: string; fields: Record<string, string> };

export type UploadPolicyRequest = {
  bucket: string;
  objectPath: string;
  contentType: string;
  maximumBytes: number;
  expiresIn: number;
};

// The browser uploads straight to R2, so the signed policy is where the per-file byte cap is
// enforced at write time: R2 rejects a body outside the declared class range instead of
// storing it. The policy also pins the object key and its content type.
export async function presignedUploadPolicy(
  client: S3Client,
  request: UploadPolicyRequest,
): Promise<UploadPolicy> {
  const { url, fields } = await createPresignedPost(client, {
    Bucket: request.bucket,
    Key: request.objectPath,
    Expires: request.expiresIn,
    Fields: { 'Content-Type': request.contentType },
    Conditions: [
      ['eq', '$Content-Type', request.contentType],
      ['content-length-range', 1, request.maximumBytes],
    ],
  });
  return { url, fields };
}
