import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readEnvironment } from './environment.ts';

const ref = 'abcdefghijklmnopqrst';
const valid = {
  SGN_ENV: 'dev',
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
};

test('dev loopback and prod HTTPS return canonical configuration', () => {
  assert.deepEqual(readEnvironment(valid, ref), {
    stage: 'dev',
    supabaseUrl: valid.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: valid.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    appUrl: valid.NEXT_PUBLIC_APP_URL,
  });
  assert.equal(
    readEnvironment(
      {
        ...valid,
        SGN_ENV: 'prod',
        NEXT_PUBLIC_APP_URL: 'https://inventory.example.test',
      },
      ref,
    ).stage,
    'prod',
  );
});

test('missing stage, placeholders, and insecure production origins are rejected', () => {
  assert.throws(
    () => readEnvironment({ ...valid, SGN_ENV: undefined }),
    /SGN_ENV/,
  );
  assert.throws(
    () =>
      readEnvironment({
        ...valid,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'YOUR_PUBLISHABLE_KEY',
      }),
    /configured/,
  );
  assert.throws(() => readEnvironment({ ...valid, SGN_ENV: 'prod' }), /HTTPS/);
  assert.throws(
    () =>
      readEnvironment({
        ...valid,
        NEXT_PUBLIC_APP_URL: 'https://user:password@example.test',
      }),
    /HTTPS/,
  );
});

test('Vercel preview redirects use the deployment origin without changing stable stages', () => {
  const preview = {
    ...valid,
    VERCEL_ENV: 'preview',
    VERCEL_URL: 'inventory-abc-team.vercel.app',
  };
  assert.equal(
    readEnvironment(preview).appUrl,
    'https://inventory-abc-team.vercel.app',
  );
  assert.equal(
    readEnvironment({ ...preview, VERCEL_URL: '' }).appUrl,
    valid.NEXT_PUBLIC_APP_URL,
  );
  assert.equal(
    readEnvironment({ ...preview, VERCEL_ENV: 'production' }).appUrl,
    valid.NEXT_PUBLIC_APP_URL,
  );
  assert.throws(
    () =>
      readEnvironment({
        ...preview,
        SGN_ENV: 'prod',
        NEXT_PUBLIC_APP_URL: 'https://prod.example.test',
      }),
    /previews must use dev/,
  );
  for (const hostname of [
    'https://inventory.vercel.app',
    'inventory.vercel.app/path',
    'inventory.vercel.app:443',
    'inventory.vercel.app.evil.test',
    'user@inventory.vercel.app',
    'inventory.vercel.app?redirect=evil',
  ]) {
    assert.throws(
      () => readEnvironment({ ...preview, VERCEL_URL: hostname }),
      /deployment hostname/,
    );
  }
});

test('release configuration cannot use another Supabase project', () => {
  assert.throws(
    () => readEnvironment(valid, 'zyxwvutsrqponmlkjihg'),
    /expected project/,
  );
});

test('privileged keys cannot enter public configuration', () => {
  const jwt = (role: string) =>
    `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  assert.throws(
    () =>
      readEnvironment({
        ...valid,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_fixture',
      }),
    /never a secret/,
  );
  assert.throws(
    () =>
      readEnvironment({
        ...valid,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt('service_role'),
      }),
    /never a secret/,
  );
  assert.throws(
    () =>
      readEnvironment({ ...valid, NEXT_PUBLIC_SUPABASE_SECRET_KEY: 'private' }),
    /must not be public/,
  );
  assert.equal(
    readEnvironment({
      ...valid,
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt('anon'),
    }).supabaseUrl,
    'http://127.0.0.1:54321',
  );
});
