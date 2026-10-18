import assert from 'node:assert/strict';
import { test } from 'node:test';
import { originAllowed } from './origin.ts';
import { acceptanceSessionBody } from '../../features/employees/invitation-acceptance.ts';

// Mirrors the invite session route: the guard is only relaxed for a body the route's own
// classifier calls the delivered token pair.
const tokenProof = (body: Record<string, unknown>) =>
  acceptanceSessionBody(body)?.kind === 'tokens';

const appUrl = 'https://sgnewhouse.online';
const prod = { stage: 'prod' as const, appUrl };
const requestOrigin = 'https://sgn-inventory-abc.vercel.app';
const headers = (values: Record<string, string>) => new Headers(values);

test('a production POST from the configured app URL is accepted', () => {
  assert.equal(
    originAllowed(headers({ origin: appUrl }), prod, requestOrigin),
    true,
  );
});

test('a production POST from the origin it was served from is accepted', () => {
  assert.equal(
    originAllowed(headers({ origin: requestOrigin }), prod, requestOrigin),
    true,
  );
});

test('without an Origin, a same-origin Referer is still accepted', () => {
  for (const referer of [`${appUrl}/employees/invite`, requestOrigin]) {
    assert.equal(
      originAllowed(headers({ referer }), prod, requestOrigin),
      true,
      referer,
    );
  }
});

test('without an Origin, a same-origin Sec-Fetch-Site is still accepted', () => {
  assert.equal(
    originAllowed(
      headers({ 'sec-fetch-site': 'same-origin' }),
      prod,
      requestOrigin,
    ),
    true,
  );
});

test('a genuine same-origin Sec-Fetch-Site is accepted on its own, whatever the baked app URL says', () => {
  assert.equal(
    originAllowed(
      headers({
        origin: 'https://an-unexpected-host.example',
        'sec-fetch-site': 'same-origin',
      }),
      prod,
      requestOrigin,
    ),
    true,
  );
});

test('Sec-Fetch-Site only ever accepts the exact same-origin value', () => {
  for (const secFetchSite of ['cross-site', 'same-site', 'none', '']) {
    assert.equal(
      originAllowed(
        headers({
          origin: 'https://an-unexpected-host.example',
          'sec-fetch-site': secFetchSite,
        }),
        prod,
        requestOrigin,
      ),
      false,
      secFetchSite,
    );
  }
});

test('a production POST with no origin evidence at all is refused', () => {
  assert.equal(originAllowed(headers({}), prod, requestOrigin), false);
});

test('a production POST with an unexpected Origin and no trusted fallback is refused', () => {
  assert.equal(
    originAllowed(
      headers({ origin: 'https://evil.example', referer: appUrl }),
      prod,
      requestOrigin,
    ),
    false,
  );
});

test('the dev stage behaves as before and never refuses on origin', () => {
  assert.equal(
    originAllowed(
      headers({
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      }),
      { stage: 'dev', appUrl: 'http://localhost:3000' },
      'http://localhost:3000',
    ),
    true,
  );
});

test('a production POST with a valid invitation token body needs no origin evidence', () => {
  for (const values of [
    {},
    { origin: 'https://evil.example' },
    { 'sec-fetch-site': 'cross-site' },
  ] as Record<string, string>[])
    assert.equal(
      originAllowed(
        headers(values),
        prod,
        requestOrigin,
        tokenProof({ accessToken: 'jwt', refreshToken: 'rt' }),
      ),
      true,
      JSON.stringify(values),
    );
});

test('the same no-evidence POST with a cookie body is still refused', () => {
  assert.equal(
    originAllowed(headers({}), prod, requestOrigin, tokenProof({})),
    false,
  );
});

test('a token body is refused on any route that does not opt in', () => {
  assert.equal(
    originAllowed(
      headers({}),
      prod,
      requestOrigin,
      tokenProof({ accessToken: 'jwt', refreshToken: 'rt' }),
    ),
    true,
  );
  // The default, used by every other guarded route, ignores the body entirely.
  assert.equal(originAllowed(headers({}), prod, requestOrigin), false);
});

test('a token-shaped body with an empty or missing token is not token proof', () => {
  for (const body of [
    { accessToken: '', refreshToken: 'rt' },
    { accessToken: 'jwt', refreshToken: '' },
    { accessToken: 'jwt' },
    { refreshToken: 'rt' },
  ])
    assert.equal(
      originAllowed(headers({}), prod, requestOrigin, tokenProof(body)),
      false,
      JSON.stringify(body),
    );
});
