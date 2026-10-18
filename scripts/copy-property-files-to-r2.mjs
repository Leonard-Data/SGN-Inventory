// One-off operator script: copy every registered property file from the Supabase
// `property-files` bucket to the private Cloudflare R2 bucket, keeping identical object keys
// so no `property_files` row has to be rewritten.
//
// Dry run by default: it lists, plans and reports. `--apply` performs the copies, then verifies.
// `--verify` skips the copies and only checks the destination. Nothing is ever deleted,
// retargeted or rewritten in Supabase: retiring the old bucket is a separate decision.
//
// Required environment (server-side only, never NEXT_PUBLIC_*):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
//
// Usage:
//   node scripts/copy-property-files-to-r2.mjs            # dry run
//   node scripts/copy-property-files-to-r2.mjs --apply    # copy, then verify
//   node scripts/copy-property-files-to-r2.mjs --verify   # verification pass only
//
// Limit: the compared key set is the registered `property_files.object_path` set, which is
// every object the application can serve. Unregistered objects left in the old bucket are not
// enumerated; list the bucket separately if the operator needs that. shortcut: registered-keys
// only, upgrade if orphan objects in the old bucket must be proven absent.
import { createHash } from 'node:crypto';
import {
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const pageSize = 1000;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured for this script`);
  return value;
}

// Pure planning step: existing matching objects are left alone, missing ones are copied, and
// an object of a different size is reported rather than overwritten. A legacy row with no
// recorded size has nothing to compare, so an existing object counts as present.
export function planCopy(rows, stored) {
  const copies = [];
  const kept = [];
  const conflicts = [];
  for (const row of rows) {
    const size = stored.get(row.object_path);
    if (size === undefined) copies.push(row);
    else if (row.size_bytes === null || size === row.size_bytes) kept.push(row);
    else conflicts.push({ ...row, storedSize: size });
  }
  const registered = new Set(rows.map((row) => row.object_path));
  const unregistered = [...stored.keys()].filter((key) => !registered.has(key));
  return { copies, kept, conflicts, unregistered };
}

async function registeredFiles() {
  const url = required('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
  const key = required('SUPABASE_SERVICE_ROLE_KEY');
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetch(
      `${url}/rest/v1/property_files?select=object_path,size_bytes,sha256,mime_type&order=object_path&limit=${pageSize}&offset=${offset}`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
        },
      },
    );
    if (!response.ok)
      throw new Error(
        `reading property_files failed: ${response.status} ${response.statusText}`,
      );
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function storage() {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    },
    // R2 rejects the SDK's default flexible checksums on real upload bodies.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return { client, bucket: required('R2_BUCKET') };
}

async function storedSizes({ client, bucket }) {
  const stored = new Map();
  let token;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: token,
        MaxKeys: pageSize,
      }),
    );
    for (const object of page.Contents ?? [])
      if (object.Key) stored.set(object.Key, object.Size ?? -1);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return stored;
}

async function download(row) {
  const url = required('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
  const key = required('SUPABASE_SERVICE_ROLE_KEY');
  const path = row.object_path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(
    `${url}/storage/v1/object/property-files/${path}`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    },
  );
  if (!response.ok)
    throw new Error(`reading ${row.object_path} failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function copy(row, { client, bucket }) {
  const bytes = await download(row);
  if (row.size_bytes !== null && bytes.length !== row.size_bytes)
    throw new Error(
      `${row.object_path} changed size in Supabase; re-run later`,
    );
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (row.sha256 && sha256 !== row.sha256)
    throw new Error(`${row.object_path} does not match its registered hash`);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: row.object_path,
      Body: bytes,
      ContentType: row.mime_type ?? 'application/octet-stream',
    }),
  );
  return bytes.length;
}

function report(plan) {
  console.log(`objects already present and matching: ${plan.kept.length}`);
  console.log(`objects to copy: ${plan.copies.length}`);
  const unmeasured = [...plan.kept, ...plan.copies].filter(
    (row) => row.size_bytes === null,
  ).length;
  if (unmeasured)
    console.log(
      `objects with no recorded size: ${unmeasured} (presence only, size not verified)`,
    );
  console.log(`objects with a size conflict: ${plan.conflicts.length}`);
  for (const row of plan.conflicts)
    console.log(
      `  conflict ${row.object_path}: registered ${row.size_bytes}, R2 has ${row.storedSize}`,
    );
  if (plan.unregistered.length)
    console.log(
      `R2 objects with no registered row: ${plan.unregistered.length} (left untouched)`,
    );
}

const main = async () => {
  const mode = process.argv.includes('--apply')
    ? 'apply'
    : process.argv.includes('--verify')
      ? 'verify'
      : 'dry-run';
  const target = storage();
  const rows = await registeredFiles();
  let plan = planCopy(rows, await storedSizes(target));
  console.log(`mode: ${mode}; registered objects: ${rows.length}`);
  report(plan);
  if (plan.conflicts.length) {
    console.log('Nothing was overwritten. Resolve the size conflicts first.');
    process.exitCode = 1;
    return;
  }
  if (mode === 'apply') {
    let copied = 0;
    for (const row of plan.copies) {
      copied += await copy(row, target);
      console.log(`copied ${row.object_path}`);
    }
    console.log(`copied ${plan.copies.length} objects (${copied} bytes)`);
  }
  if (mode !== 'dry-run') {
    plan = planCopy(rows, await storedSizes(target));
    const complete =
      plan.copies.length === 0 &&
      plan.conflicts.length === 0 &&
      rows.length === plan.kept.length;
    console.log(
      `verification: ${plan.kept.length}/${rows.length} registered objects present with matching size`,
    );
    if (!complete) process.exitCode = 1;
  }
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
