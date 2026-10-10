import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readEnvironment } from '../src/lib/environment.ts';

export function releaseTarget(values) {
  const stage = values.SGN_ENV;
  assert.ok(stage === 'dev' || stage === 'prod', 'Select dev or prod');
  assert.equal(
    values.GITHUB_REF,
    stage === 'prod' ? 'refs/heads/main' : 'refs/heads/develop',
    'Release must run on the trusted stage branch',
  );
  const dev = values.DEV_SUPABASE_PROJECT_REF;
  const prod = values.PROD_SUPABASE_PROJECT_REF;
  assert.match(dev ?? '', /^[a-z]{20}$/, 'Configure dev Supabase project ref');
  assert.match(
    prod ?? '',
    /^[a-z]{20}$/,
    'Configure prod Supabase project ref',
  );
  assert.notEqual(dev, prod, 'Dev and prod databases must differ');
  const projectRef = stage === 'prod' ? prod : dev;
  assert.equal(
    values.SUPABASE_PROJECT_REF,
    projectRef,
    'Wrong stage database selected',
  );
  return { stage, projectRef };
}

export function releaseConfiguration(values) {
  const target = releaseTarget(values);
  const dev = values.DEV_VERCEL_PROJECT_ID;
  const prod = values.PROD_VERCEL_PROJECT_ID;
  assert.match(
    dev ?? '',
    /^prj_[A-Za-z0-9]+$/,
    'Configure dev Vercel project ID',
  );
  assert.match(
    prod ?? '',
    /^prj_[A-Za-z0-9]+$/,
    'Configure prod Vercel project ID',
  );
  assert.notEqual(dev, prod, 'Dev and prod hosting projects must differ');
  assert.equal(
    values.VERCEL_PROJECT_ID,
    target.stage === 'prod' ? prod : dev,
    'Wrong stage hosting project selected',
  );
  assert.ok(values.VERCEL_ORG_ID, 'Configure Vercel organization ID');
  readEnvironment(values, target.projectRef);
  return target;
}

export function verifyPulledConfiguration(values, project, pulled) {
  releaseConfiguration(values);
  assert.equal(
    project.projectId,
    values.VERCEL_PROJECT_ID,
    'Pulled hosting project mismatch',
  );
  assert.equal(
    project.orgId,
    values.VERCEL_ORG_ID,
    'Pulled organization mismatch',
  );
  for (const name of [
    'SGN_ENV',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_APP_URL',
  ]) {
    assert.equal(pulled[name], values[name], `Pulled ${name} mismatch`);
  }
  readEnvironment(pulled, values.SUPABASE_PROJECT_REF);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const command = process.argv[2];
    if (command === 'target') {
      releaseTarget(process.env);
    } else if (command === 'configuration') {
      releaseConfiguration(process.env);
    } else if (command === 'pulled') {
      verifyPulledConfiguration(
        process.env,
        JSON.parse(await readFile('.vercel/project.json', 'utf8')),
        parseEnv(await readFile('.vercel/.env.production.local', 'utf8')),
      );
    } else if (command === 'smoke') {
      const { stage } = releaseConfiguration(process.env);
      const url = new URL('/api/health', process.env.DEPLOYMENT_URL);
      assert.equal(url.protocol, 'https:', 'Deployment URL must use HTTPS');
      const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
        ? {
            'x-vercel-protection-bypass':
              process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          }
        : {};
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(
        response.status,
        200,
        'Deployment health must return 200; configure protection bypass if required',
      );
      assert.deepEqual(
        await response.json(),
        { status: 'ok', stage },
        'Deployment stage mismatch',
      );
    } else {
      throw new Error('Use target, configuration, pulled, or smoke');
    }
    console.log(`Release ${command} check passed`);
  } catch {
    // Assertions may contain compared key values; never print their payloads.
    console.error(
      'Release check failed: verify branch, stage, project IDs, configuration and deployment health.',
    );
    process.exitCode = 1;
  }
}
