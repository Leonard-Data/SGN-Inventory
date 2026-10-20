import { GetBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';
import { readEnvironment } from '../src/lib/environment.ts';
import { corsVerdict, noCorsConfiguration } from '../src/lib/r2-cors.ts';

let environment = null;
try {
  environment = readEnvironment(
    process.env,
    process.env.EXPECTED_SUPABASE_PROJECT_REF,
  );
  console.log(`Environment valid: ${environment.stage}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid environment');
  process.exitCode = 1;
}

// Property file bytes live in a private Cloudflare R2 bucket. A partly configured bucket is a
// real misconfiguration; a wholly absent one only disables property files (no live credentials
// are needed for CI). Names are printed, never values.
const r2Names = [
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
];
const r2Present = r2Names.filter((name) => process.env[name]?.trim());
const bucket = process.env.R2_BUCKET?.trim() ?? '';
if (r2Present.length && r2Present.length < r2Names.length) {
  console.error(
    `R2 storage is partly configured; missing ${r2Names.filter((name) => !r2Present.includes(name)).join(', ')}`,
  );
  process.exitCode = 1;
} else if (!r2Present.length) {
  console.log(
    'R2 storage: not configured; property file upload and open will fail closed',
  );
} else if (!environment) {
  console.error(
    `R2 storage: the CORS rule of bucket "${bucket}" is unverified because NEXT_PUBLIC_APP_URL is not a usable origin; fix the environment error above and re-run`,
  );
  process.exitCode = 1;
} else {
  // Presence of the four values says nothing about whether the browser can use the bucket, so
  // the rule itself is read (never written) with the same credentials the app uploads with.
  const appUrl = environment.appUrl;
  const advice = `install one rule allowing ${appUrl} as the origin, the GET and PUT methods, and the content-type and if-none-match request headers`;
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID?.trim()}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID?.trim() ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY?.trim() ?? '',
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  try {
    let rules;
    try {
      rules = (await client.send(new GetBucketCorsCommand({ Bucket: bucket })))
        .CORSRules;
    } catch (error) {
      if (!noCorsConfiguration(error)) throw error;
    }
    const verdict = corsVerdict(rules, appUrl);
    if (verdict.ok) {
      console.log(
        `R2 storage: configured; bucket "${bucket}" admits a browser upload and open from ${appUrl}`,
      );
    } else {
      console.error(`R2 bucket "${bucket}" ${verdict.detail}; ${advice}`);
      process.exitCode = 1;
    }
  } catch (error) {
    // A check that cannot see the answer must not claim it: this is not a pass.
    const reason =
      error instanceof Error
        ? `${error.name}: ${error.message.replace(/\s+/g, ' ').trim()}`
        : String(error);
    console.error(
      `R2 storage: the CORS rule of bucket "${bucket}" is unverified (${reason}), so a browser upload may still be refused; ${advice}, and check that the credential may read the bucket's CORS configuration`,
    );
    process.exitCode = 1;
  }
}
