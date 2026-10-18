import assert from 'node:assert/strict';
import test from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import { presignedUploadPut } from './r2-upload.ts';

const client = new S3Client({
  region: 'auto',
  endpoint: 'https://r2.example.test',
  forcePathStyle: true,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

async function issued(contentLength: number, expiresIn = 60) {
  const signature = await presignedUploadPut(client, {
    bucket: 'property-files',
    objectPath: 'property-a/file-1/content',
    contentType: 'application/pdf',
    contentLength,
    expiresIn,
  });
  const url = new URL(signature.url);
  const signedHeaders = (url.searchParams.get('X-Amz-SignedHeaders') ?? '')
    .split(';')
    .sort();
  return { signature, url, signedHeaders };
}

// The signature is the write control: R2 validates these headers itself, so a PUT without
// the conditional create, or with any body length other than the registered one, is refused
// before it can store a byte.
test('the upload signature covers the declared length and the conditional create', async () => {
  const { signature, signedHeaders } = await issued(2 * 1024 * 1024);
  assert.deepEqual(signedHeaders, ['content-length', 'host', 'if-none-match']);
  assert.equal(signature.contentLength, 2 * 1024 * 1024);
});

test('the signature is bound to the object key and the short-lived window', async () => {
  const { url } = await issued(1024, 60);
  assert.equal(
    url.origin + url.pathname,
    'https://r2.example.test/property-files/property-a/file-1/content',
  );
  assert.equal(url.searchParams.get('X-Amz-Expires'), '60');
});

test('each registered size earns its own signature', async () => {
  const small = await issued(1024);
  const capped = await issued(20 * 1024 * 1024);
  assert.equal(small.signature.contentLength, 1024);
  assert.equal(capped.signature.contentLength, 20 * 1024 * 1024);
  assert.notEqual(small.url.searchParams.get('X-Amz-Signature'), null);
  assert.notEqual(
    small.url.searchParams.get('X-Amz-Signature'),
    capped.url.searchParams.get('X-Amz-Signature'),
  );
});
