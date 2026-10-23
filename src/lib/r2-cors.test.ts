import assert from 'node:assert/strict';
import test from 'node:test';
import { corsVerdict, noCorsConfiguration, type CorsRule } from './r2-cors.ts';

const appUrl = 'https://sgn.example';

function rule(overrides: Partial<CorsRule> = {}): CorsRule {
  return {
    AllowedOrigins: [appUrl],
    AllowedMethods: ['GET', 'PUT'],
    AllowedHeaders: ['content-type', 'if-none-match'],
    ...overrides,
  };
}

// A bucket with storage credentials but no rule is exactly the production failure this checks
// for, so it must fail rather than pass.
test('a bucket with no CORS rule fails and says so', () => {
  for (const rules of [undefined, []]) {
    const verdict = corsVerdict(rules, appUrl);
    assert.equal(verdict.ok, false);
    assert.match(verdict.ok ? '' : verdict.detail, /has no CORS rule/);
  }
});

test('a rule that admits the origin, both methods and the upload headers passes', () => {
  assert.deepEqual(corsVerdict([rule()], appUrl), { ok: true });
});

test('a rule that omits the application origin fails', () => {
  const verdict = corsVerdict(
    [rule({ AllowedOrigins: ['https://other.example'] })],
    appUrl,
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok ? '' : verdict.detail, /no CORS rule allowing a PUT/);
});

// A presigned upload is a signed browser PUT: a rule that allows only GET cannot serve it.
test('a rule without the PUT method fails the upload', () => {
  const verdict = corsVerdict([rule({ AllowedMethods: ['GET'] })], appUrl);
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok ? '' : verdict.detail, /PUT/);
});

test('a rule without the upload request headers fails the upload', () => {
  for (const headers of [
    ['content-type'],
    ['if-none-match'],
    ['content-type', 'if-match'],
  ]) {
    const verdict = corsVerdict([rule({ AllowedHeaders: headers })], appUrl);
    assert.equal(verdict.ok, false);
    assert.match(verdict.ok ? '' : verdict.detail, /if-none-match/);
  }
});

test('a rule without the GET method fails the presigned open', () => {
  const verdict = corsVerdict([rule({ AllowedMethods: ['PUT'] })], appUrl);
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok ? '' : verdict.detail, /GET/);
});

test('an origin wildcard admits the application origin', () => {
  assert.deepEqual(corsVerdict([rule({ AllowedOrigins: ['*'] })], appUrl), {
    ok: true,
  });
  assert.deepEqual(
    corsVerdict([rule({ AllowedOrigins: ['https://*.example'] })], appUrl),
    { ok: true },
  );
});

test('a header wildcard admits the upload request headers', () => {
  assert.deepEqual(corsVerdict([rule({ AllowedHeaders: ['*'] })], appUrl), {
    ok: true,
  });
});

test('a wildcard origin does not admit a different domain', () => {
  const verdict = corsVerdict(
    [rule({ AllowedOrigins: ['https://*.example'] })],
    'https://sgn.example.evil',
  );
  assert.equal(verdict.ok, false);
});

// Only an absent policy is a definite failure. A refused or failed read must reach the check as
// unverified, so it must never be classified as "no rule".
test('only an absent policy counts as no rule', () => {
  assert.equal(noCorsConfiguration({ name: 'NoSuchCORSConfiguration' }), true);
  assert.equal(
    noCorsConfiguration({ $metadata: { httpStatusCode: 404 } }),
    true,
  );
  assert.equal(
    noCorsConfiguration({
      name: 'NoSuchBucket',
      $metadata: { httpStatusCode: 404 },
    }),
    false,
  );
  assert.equal(
    noCorsConfiguration({
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
    }),
    false,
  );
  assert.equal(noCorsConfiguration(new Error('network down')), false);
});
