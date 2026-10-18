import assert from 'node:assert/strict';
import test from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import { presignedUploadPolicy } from './r2-upload.ts';

const twentyMiB = 20 * 1024 * 1024;
const fiveMiB = 5 * 1024 * 1024;

const client = new S3Client({
  region: 'auto',
  endpoint: 'https://r2.example.test',
  forcePathStyle: true,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

type Condition = unknown[] | Record<string, string>;

async function issued(contentType: string, maximumBytes: number) {
  const { url, fields } = await presignedUploadPolicy(client, {
    bucket: 'property-files',
    objectPath: 'property-a/file-1/content',
    contentType,
    maximumBytes,
    expiresIn: 60,
  });
  const encoded = fields.Policy ?? fields.policy;
  assert.ok(encoded, 'the issued form carries a signed policy');
  const policy = JSON.parse(
    Buffer.from(encoded, 'base64').toString('utf8'),
  ) as {
    expiration: string;
    conditions: Condition[];
  };
  const range = policy.conditions.find(
    (condition) =>
      Array.isArray(condition) && condition[0] === 'content-length-range',
  );
  return { url, fields, policy, range };
}

function pinned(
  conditions: Condition[],
  field: string,
  value: string,
): boolean {
  return conditions.some(
    (condition) =>
      Array.isArray(condition) &&
      condition[0] === 'eq' &&
      condition[1] === `$${field}` &&
      condition[2] === value,
  );
}

test('a document upload policy bounds the body to 20 MiB', async () => {
  const { range } = await issued('application/pdf', twentyMiB);
  assert.deepEqual(range, ['content-length-range', 1, twentyMiB]);
});

test('an image upload policy bounds the body to 5 MiB', async () => {
  const { range } = await issued('image/png', fiveMiB);
  assert.deepEqual(range, ['content-length-range', 1, fiveMiB]);
});

test('the policy pins the object key, bucket and content type', async () => {
  const { url, fields, policy } = await issued('image/webp', fiveMiB);
  assert.equal(url, 'https://r2.example.test/property-files');
  assert.equal(fields.key, 'property-a/file-1/content');
  assert.equal(fields.bucket, 'property-files');
  assert.equal(fields['Content-Type'], 'image/webp');
  assert.ok(pinned(policy.conditions, 'Content-Type', 'image/webp'));
  assert.ok(
    policy.conditions.some(
      (entry) =>
        !Array.isArray(entry) && entry.key === 'property-a/file-1/content',
    ),
  );
  assert.ok(
    policy.conditions.some(
      (entry) => !Array.isArray(entry) && entry.bucket === 'property-files',
    ),
  );
});

test('the policy expires within the short-lived upload window', async () => {
  const before = Date.now();
  const { policy } = await issued('application/pdf', twentyMiB);
  const remaining = Date.parse(policy.expiration) - before;
  assert.ok(remaining > 0 && remaining <= 61_000, String(remaining));
});
