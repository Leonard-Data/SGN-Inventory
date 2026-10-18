import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readEnvironment } from '../src/lib/environment.ts';

// Stage-scoped activation. Exactly one repository variable owns each delivery
// kind, and a kind is enabled only by its own switch, so setting the preview or
// development switch can never enable a production run (or the reverse). Absent
// and non-literal values stay off, so every kind is disabled by default.
const CD_ACTIVATION_SWITCH = {
  preview: 'CD_PREVIEW_ENABLED',
  dev: 'CD_DEV_ENABLED',
  prod: 'CD_PROD_ENABLED',
};

export function cdActivation(kind, values) {
  assert.ok(
    Object.hasOwn(CD_ACTIVATION_SWITCH, kind),
    'Use a known CD activation kind',
  );
  return values[CD_ACTIVATION_SWITCH[kind]] === 'true';
}

export function releaseTarget(values) {
  const stage = values.SGN_ENV;
  assert.ok(stage === 'dev' || stage === 'prod', 'Select dev or prod');
  if (values.VERCEL_TARGET === 'preview') {
    assert.equal(stage, 'dev', 'Previews must use dev resources');
    assert.equal(
      values.GITHUB_EVENT_NAME,
      'pull_request',
      'Preview requires a pull request',
    );
    assert.match(
      values.GITHUB_REF ?? '',
      /^refs\/pull\/[1-9]\d*\/merge$/,
      'Preview requires a pull request merge ref',
    );
    assert.ok(values.GITHUB_REPOSITORY, 'Configure repository identity');
    assert.equal(
      values.GITHUB_HEAD_REPOSITORY,
      values.GITHUB_REPOSITORY,
      'Fork previews cannot receive deployment credentials',
    );
  } else {
    assert.ok(
      !values.VERCEL_TARGET || values.VERCEL_TARGET === 'production',
      'Unknown Vercel target',
    );
    assert.equal(
      values.GITHUB_REF,
      stage === 'prod' ? 'refs/heads/main' : 'refs/heads/develop',
      'Release must run on the trusted stage branch',
    );
  }
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

// A protection-protected project answers its ephemeral *.vercel.app address with
// an HTML login page, so a stage release smokes the origin that stage actually
// serves. A preview has no canonical origin of its own and must keep proving the
// deployment the workflow just created.
export function stageHealth(values) {
  const { stage } = releaseConfiguration(values);
  const origin =
    values.VERCEL_TARGET === 'preview'
      ? values.DEPLOYMENT_URL
      : values.NEXT_PUBLIC_APP_URL;
  const url = new URL('/api/health', origin);
  assert.equal(url.protocol, 'https:', 'Deployment URL must use HTTPS');
  return { stage, url };
}

const bodyExcerpt = (body) =>
  body.replace(/\s+/g, ' ').trim().slice(0, 200) || '(empty)';

// A release health failure has to name the URL, status and body that produced it;
// the configuration assertions above stay masked because they compare key values.
export class ReleaseSmokeError extends Error {}

export async function checkStageHealth(values, fetchImpl = fetch) {
  const { stage, url } = stageHealth(values);
  const headers = values.VERCEL_AUTOMATION_BYPASS_SECRET
    ? {
        'x-vercel-protection-bypass': values.VERCEL_AUTOMATION_BYPASS_SECRET,
      }
    : {};
  let response;
  try {
    response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new ReleaseSmokeError(
      `Deployment health check could not reach ${url}: ${error?.cause?.code ?? error?.message ?? error}`,
    );
  }
  const body = await response.text();
  if (response.status !== 200) {
    throw new ReleaseSmokeError(
      `Deployment health check ${url} returned ${response.status}; set VERCEL_AUTOMATION_BYPASS_SECRET if that origin is protected. Body: ${bodyExcerpt(body)}`,
    );
  }
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new ReleaseSmokeError(
      `Deployment health check ${url} returned 200 with a non-JSON body; set VERCEL_AUTOMATION_BYPASS_SECRET if that origin is protected. Body: ${bodyExcerpt(body)}`,
    );
  }
  try {
    assert.deepEqual(payload, { status: 'ok', stage });
  } catch {
    throw new ReleaseSmokeError(
      `Deployment health check ${url} expected {"status":"ok","stage":"${stage}"}. Body: ${bodyExcerpt(body)}`,
    );
  }
  return payload;
}

// A verify-only run must never pass while the database is behind the commit it
// is releasing, so the dry run has to prove it is up to date before the release
// proceeds. The payload is the pinned CLI's `--output-format json` dry-run result.
export function releasePendingMigrations(dryRun) {
  assert.equal(
    dryRun?.dryRun,
    true,
    'Pending migrations must come from a migration dry run',
  );
  assert.ok(
    Array.isArray(dryRun.migrations),
    'Migration dry run must list its pending migrations',
  );
  assert.equal(
    dryRun.migrations.length,
    0,
    'Pending migrations must be applied before the application release',
  );
  return { pending: dryRun.migrations };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const command = process.argv[2];
    if (command === 'target') {
      releaseTarget(process.env);
    } else if (command === 'activation') {
      assert.ok(
        cdActivation(process.env.SGN_CD_KIND, process.env),
        'CD is not activated for this stage',
      );
    } else if (command === 'configuration') {
      releaseConfiguration(process.env);
    } else if (command === 'pulled') {
      verifyPulledConfiguration(
        process.env,
        JSON.parse(await readFile('.vercel/project.json', 'utf8')),
        parseEnv(
          await readFile(
            process.env.VERCEL_TARGET === 'preview'
              ? '.vercel/.env.preview.local'
              : '.vercel/.env.production.local',
            'utf8',
          ),
        ),
      );
    } else if (command === 'smoke') {
      await checkStageHealth(process.env);
    } else if (command === 'pending') {
      releasePendingMigrations(
        JSON.parse(await readFile(process.argv[3], 'utf8')),
      );
    } else {
      throw new Error(
        'Use target, activation, configuration, pending, pulled, or smoke',
      );
    }
    console.log(`Release ${command} check passed`);
  } catch (error) {
    if (error instanceof ReleaseSmokeError) {
      console.error(error.message);
    } else {
      // Assertions may contain compared key values; never print their payloads.
      console.error(
        'Release check failed: verify stage activation, branch, stage, project IDs, configuration, pending migrations and deployment health.',
      );
    }
    process.exitCode = 1;
  }
}
