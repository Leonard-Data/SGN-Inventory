import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  releaseTarget,
  releaseConfiguration,
  verifyPulledConfiguration,
} from './release-guard.mjs';

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
