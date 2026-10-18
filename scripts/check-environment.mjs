import { readEnvironment } from '../src/lib/environment.ts';

try {
  const environment = readEnvironment(
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
if (r2Present.length && r2Present.length < r2Names.length) {
  console.error(
    `R2 storage is partly configured; missing ${r2Names.filter((name) => !r2Present.includes(name)).join(', ')}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `R2 storage: ${r2Present.length ? 'configured' : 'not configured; property file upload and open will fail closed'}`,
  );
}
