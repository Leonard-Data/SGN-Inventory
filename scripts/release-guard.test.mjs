import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cdActivation,
  releaseTarget,
  releaseConfiguration,
  releasePendingMigrations,
  verifyPulledConfiguration,
  checkStageHealth,
  ReleaseSmokeError,
} from './release-guard.mjs';

test('stage activation never leaks across delivery kinds', () => {
  // Every kind is off until its own switch is set, so an unconfigured
  // repository can start no preview, development or production release.
  for (const kind of ['preview', 'dev', 'prod']) {
    assert.equal(cdActivation(kind, {}), false);
  }
  assert.equal(cdActivation('preview', { CD_PREVIEW_ENABLED: 'true' }), true);
  assert.equal(cdActivation('dev', { CD_DEV_ENABLED: 'true' }), true);
  assert.equal(cdActivation('prod', { CD_PROD_ENABLED: 'true' }), true);
  // Enabling preview or development delivery can never enable production, and
  // the production switch can never start a development release.
  assert.equal(cdActivation('prod', { CD_DEV_ENABLED: 'true' }), false);
  assert.equal(cdActivation('prod', { CD_PREVIEW_ENABLED: 'true' }), false);
  assert.equal(cdActivation('dev', { CD_PREVIEW_ENABLED: 'true' }), false);
  assert.equal(
    cdActivation('prod', {
      CD_PREVIEW_ENABLED: 'true',
      CD_DEV_ENABLED: 'true',
    }),
    false,
  );
  // Only the exact literal enables a kind; a near-miss value stays off.
  for (const value of ['TRUE', 'yes', '1', 'true ']) {
    assert.equal(cdActivation('dev', { CD_DEV_ENABLED: value }), false);
  }
  assert.throws(
    () => cdActivation('staging', { CD_DEV_ENABLED: 'true' }),
    /known CD activation kind/,
  );
});

const dev = {
  SGN_ENV: 'dev',
  GITHUB_REF: 'refs/heads/develop',
  DEV_SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
  PROD_SUPABASE_PROJECT_REF: 'zyxwvutsrqponmlkjihg',
  SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
  DEV_VERCEL_PROJECT_ID: 'prj_dev',
  PROD_VERCEL_PROJECT_ID: 'prj_prod',
  VERCEL_PROJECT_ID: 'prj_dev',
  VERCEL_ORG_ID: 'team_fixture',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  NEXT_PUBLIC_APP_URL: 'https://dev.example.test',
};

test('release rejects cross-stage branches and identical databases', () => {
  assert.deepEqual(releaseTarget(dev), {
    stage: 'dev',
    projectRef: dev.SUPABASE_PROJECT_REF,
  });
  assert.throws(
    () => releaseTarget({ ...dev, GITHUB_REF: 'refs/heads/feature' }),
    /trusted stage branch/,
  );
  assert.throws(
    () => releaseTarget({ ...dev, SGN_ENV: 'prod' }),
    /trusted stage branch/,
  );
  assert.throws(
    () =>
      releaseTarget({
        ...dev,
        PROD_SUPABASE_PROJECT_REF: dev.DEV_SUPABASE_PROJECT_REF,
      }),
    /must differ/,
  );
  assert.throws(
    () =>
      releaseTarget({
        ...dev,
        SUPABASE_PROJECT_REF: dev.PROD_SUPABASE_PROJECT_REF,
      }),
    /Wrong stage/,
  );
});

test('release rejects mismatched or shared hosting projects', () => {
  assert.equal(releaseConfiguration(dev).stage, 'dev');
  assert.throws(
    () => releaseConfiguration({ ...dev, VERCEL_PROJECT_ID: 'prj_prod' }),
    /Wrong stage hosting/,
  );
  assert.throws(
    () => releaseConfiguration({ ...dev, PROD_VERCEL_PROJECT_ID: 'prj_dev' }),
    /must differ/,
  );
  const prod = {
    ...dev,
    SGN_ENV: 'prod',
    GITHUB_REF: 'refs/heads/main',
    SUPABASE_PROJECT_REF: dev.PROD_SUPABASE_PROJECT_REF,
    VERCEL_PROJECT_ID: 'prj_prod',
    NEXT_PUBLIC_SUPABASE_URL: `https://${dev.PROD_SUPABASE_PROJECT_REF}.supabase.co`,
    NEXT_PUBLIC_APP_URL: 'https://inventory.example.test',
  };
  assert.deepEqual(releaseConfiguration(prod), {
    stage: 'prod',
    projectRef: dev.PROD_SUPABASE_PROJECT_REF,
  });
});

test('downloaded Vercel configuration cannot override the selected stage', () => {
  const project = {
    projectId: dev.VERCEL_PROJECT_ID,
    orgId: dev.VERCEL_ORG_ID,
  };
  assert.throws(
    () =>
      verifyPulledConfiguration(
        dev,
        { ...project, projectId: 'prj_prod' },
        dev,
      ),
    /project mismatch/,
  );
  assert.throws(
    () => verifyPulledConfiguration(dev, project, { ...dev, SGN_ENV: 'prod' }),
    /SGN_ENV mismatch/,
  );
  assert.throws(
    () =>
      verifyPulledConfiguration(dev, project, {
        ...dev,
        NEXT_PUBLIC_SUPABASE_URL: `https://${dev.PROD_SUPABASE_PROJECT_REF}.supabase.co`,
      }),
    /URL mismatch/,
  );
  assert.throws(
    () =>
      verifyPulledConfiguration(dev, project, {
        ...dev,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_other',
      }),
    /KEY mismatch/,
  );
});

const preview = {
  ...dev,
  VERCEL_TARGET: 'preview',
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_REF: 'refs/pull/123/merge',
  GITHUB_REPOSITORY: 'example/inventory',
  GITHUB_HEAD_REPOSITORY: 'example/inventory',
};

test('same-repository previews use only the dev project and database', () => {
  assert.deepEqual(releaseConfiguration(preview), {
    stage: 'dev',
    projectRef: dev.SUPABASE_PROJECT_REF,
  });
  verifyPulledConfiguration(
    preview,
    {
      projectId: dev.VERCEL_PROJECT_ID,
      orgId: dev.VERCEL_ORG_ID,
    },
    { ...dev, VERCEL_ENV: 'preview' },
  );
  for (const change of [
    { SGN_ENV: 'prod' },
    { GITHUB_HEAD_REPOSITORY: 'fork/inventory' },
    { GITHUB_REPOSITORY: undefined, GITHUB_HEAD_REPOSITORY: undefined },
    { GITHUB_EVENT_NAME: 'pull_request_target' },
    { GITHUB_EVENT_NAME: 'push' },
    { GITHUB_REF: 'refs/heads/main' },
    { VERCEL_PROJECT_ID: dev.PROD_VERCEL_PROJECT_ID },
    { SUPABASE_PROJECT_REF: dev.PROD_SUPABASE_PROJECT_REF },
    { VERCEL_TARGET: 'unknown' },
  ]) {
    assert.throws(() => releaseConfiguration({ ...preview, ...change }));
  }
  assert.throws(() =>
    verifyPulledConfiguration(
      preview,
      {
        projectId: dev.VERCEL_PROJECT_ID,
        orgId: dev.VERCEL_ORG_ID,
      },
      { ...dev, SGN_ENV: 'prod' },
    ),
  );
});

// Mirrors the pinned CLI's `supabase db push --dry-run --output-format json`
// result shape for both outcomes, so a verify-only release cannot pass while the
// database is behind the commit being released.
test('verify-only release fails while migrations are pending', () => {
  assert.deepEqual(
    releasePendingMigrations({
      upToDate: true,
      dryRun: true,
      migrations: [],
      seeds: [],
      roles: [],
      message: 'Remote database is up to date.',
    }),
    { pending: [] },
  );
  assert.throws(
    () =>
      releasePendingMigrations({
        upToDate: false,
        dryRun: true,
        migrations: ['20261014093000_add_property_note.sql'],
        seeds: [],
        roles: [],
        message: 'Finished supabase db push.',
      }),
    /must be applied before the application release/,
  );
  assert.throws(
    () =>
      releasePendingMigrations({
        upToDate: false,
        dryRun: false,
        migrations: ['20261014093000_add_property_note.sql'],
      }),
    /must come from a migration dry run/,
  );
  assert.throws(
    () => releasePendingMigrations({ upToDate: true, dryRun: true }),
    /must list its pending migrations/,
  );
});

const prodRelease = {
  ...dev,
  SGN_ENV: 'prod',
  GITHUB_REF: 'refs/heads/main',
  SUPABASE_PROJECT_REF: dev.PROD_SUPABASE_PROJECT_REF,
  VERCEL_PROJECT_ID: 'prj_prod',
  NEXT_PUBLIC_SUPABASE_URL: `https://${dev.PROD_SUPABASE_PROJECT_REF}.supabase.co`,
  NEXT_PUBLIC_APP_URL: 'https://inventory.example.test',
  // The ephemeral address whose project protection answers with its SSO page.
  DEPLOYMENT_URL: 'https://sgn-abc123.vercel.app',
};

function fakeFetch(body, status = 200) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), headers: init?.headers ?? {} });
      return new Response(body, { status });
    },
  };
}

test('release smoke reads the origin the stage serves, not the deployment URL', async () => {
  const canonical = fakeFetch('{"status":"ok","stage":"prod"}');
  assert.deepEqual(
    await checkStageHealth(
      { ...prodRelease, VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass-fixture' },
      canonical.fetchImpl,
    ),
    { status: 'ok', stage: 'prod' },
  );
  assert.deepEqual(canonical.calls, [
    {
      url: 'https://inventory.example.test/api/health',
      headers: { 'x-vercel-protection-bypass': 'bypass-fixture' },
    },
  ]);
  // A preview has no canonical origin of its own, so it still proves the
  // deployment it just created instead of the unrelated stable dev site.
  const ephemeral = fakeFetch('{"status":"ok","stage":"dev"}');
  await checkStageHealth(
    {
      ...preview,
      VERCEL_ENV: undefined,
      DEPLOYMENT_URL: 'https://sgn-pr-123.vercel.app',
    },
    ephemeral.fetchImpl,
  );
  assert.equal(
    ephemeral.calls[0].url,
    'https://sgn-pr-123.vercel.app/api/health',
  );
});

test('release smoke reports the stage mismatch it found', async () => {
  const mismatch = fakeFetch('{"status":"ok","stage":"dev"}');
  await assert.rejects(
    checkStageHealth(prodRelease, mismatch.fetchImpl),
    (error) =>
      error instanceof ReleaseSmokeError &&
      /https:\/\/inventory\.example\.test\/api\/health/.test(error.message) &&
      /"stage":"prod"/.test(error.message) &&
      /"stage":"dev"/.test(error.message),
  );
});

test('release smoke refuses a 200 HTML body instead of parsing it', async () => {
  const protectedPage = fakeFetch(
    '<!DOCTYPE html><html><body>Sign in to Vercel</body></html>',
  );
  await assert.rejects(
    checkStageHealth(prodRelease, protectedPage.fetchImpl),
    (error) =>
      error instanceof ReleaseSmokeError &&
      /https:\/\/inventory\.example\.test\/api\/health/.test(error.message) &&
      /non-JSON body/.test(error.message) &&
      /Sign in to Vercel/.test(error.message),
  );
});
