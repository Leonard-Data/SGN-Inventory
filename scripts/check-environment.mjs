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
