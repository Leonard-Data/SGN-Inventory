import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPLOYEE_NAME_MAX_LENGTH,
  acceptanceBody,
  acceptanceName,
  acceptancePassword,
  acceptanceSessionBody,
  classifyAuthFailure,
  isSamePasswordRefusal,
} from './invitation-acceptance.ts';

const invitationId = '30000000-0000-4000-8000-000000000001';

test('the required name is trimmed, bounded and preserves its spelling', () => {
  assert.equal(acceptanceName('  Nguyễn Văn Ẩn  '), 'Nguyễn Văn Ẩn');
  assert.equal(acceptanceName('Jane Doe'), 'Jane Doe');
  for (const value of [
    '',
    '   ',
    'a'.repeat(EMPLOYEE_NAME_MAX_LENGTH + 1),
    null,
    42,
    ['name'],
  ])
    assert.equal(acceptanceName(value), null, JSON.stringify(value));
  assert.equal(
    acceptanceName('a'.repeat(EMPLOYEE_NAME_MAX_LENGTH))?.length,
    EMPLOYEE_NAME_MAX_LENGTH,
  );
});

test('the backend password bound mirrors the recovery flow', () => {
  assert.equal(acceptancePassword('S3cure!pass'), 'S3cure!pass');
  for (const value of [
    '',
    'short7c',
    'a'.repeat(129),
    null,
    42,
    { password: 'x' },
  ])
    assert.equal(acceptancePassword(value), null, JSON.stringify(value));
  assert.equal(acceptancePassword('a'.repeat(8)), 'a'.repeat(8));
  assert.equal(acceptancePassword('a'.repeat(128)), 'a'.repeat(128));
});

test('an auth failure is retryable only for a transient or throttled provider', () => {
  const cases: [Parameters<typeof classifyAuthFailure>[0], string][] = [
    [{ name: 'AuthRetryableFetchError' }, 'retryable'],
    [{ name: 'AuthRetryableFetchError', status: 400 }, 'retryable'],
    [{ name: 'AuthApiError', status: 500 }, 'retryable'],
    [{ name: 'AuthApiError', status: 502 }, 'retryable'],
    [{ name: 'AuthApiError', status: 503 }, 'retryable'],
    [{ name: 'AuthApiError', status: 429 }, 'retryable'],
    [{ name: 'AuthApiError', status: 400 }, 'definite'],
    [{ name: 'AuthApiError', status: 401 }, 'definite'],
    [{ name: 'AuthApiError', status: 403 }, 'definite'],
    [{ name: 'AuthApiError', status: 422 }, 'definite'],
    [{ name: 'AuthApiError', status: 0 }, 'definite'],
    [{}, 'definite'],
    [null, 'definite'],
    [undefined, 'definite'],
  ];
  for (const [error, expected] of cases)
    assert.equal(classifyAuthFailure(error), expected, JSON.stringify(error));
});

test('only the unchanged-password refusal counts as an already-set credential', () => {
  const cases: [
    { code?: string; name?: string; status?: number } | null | undefined,
    boolean,
  ][] = [
    [{ code: 'same_password' }, true],
    [{ code: 'same_password', name: 'AuthApiError', status: 422 }, true],
    [{ code: 'weak_password', name: 'AuthApiError', status: 422 }, false],
    [
      { code: 'reauthentication_needed', name: 'AuthApiError', status: 403 },
      false,
    ],
    [{ name: 'AuthRetryableFetchError' }, false],
    [{}, false],
    [null, false],
    [undefined, false],
  ];
  for (const [error, expected] of cases)
    assert.equal(isSamePasswordRefusal(error), expected, JSON.stringify(error));
});

test('the acceptance request accepts exactly the six validated fields', () => {
  assert.deepEqual(
    acceptanceBody({
      invitationId,
      revision: 2,
      name: '  Nguyễn Văn Ẩn  ',
      password: 'S3cure!pass',
      confirmPassword: 'S3cure!pass',
      locale: 'en',
    }),
    {
      invitationId,
      revision: 2,
      name: 'Nguyễn Văn Ẩn',
      password: 'S3cure!pass',
      confirmPassword: 'S3cure!pass',
      locale: 'en',
    },
  );
  for (const body of [
    {},
    {
      invitationId,
      revision: 2,
      name: 'x',
      password: 'S3cure!pass',
      confirmPassword: 'S3cure!pass',
    },
    {
      invitationId,
      revision: 2,
      name: 'x',
      password: 'S3cure!pass',
      confirmPassword: 'S3cure!pass',
      locale: 'en',
      extra: true,
    },
    {
      invitationId: 'not-a-uuid',
      revision: 2,
      name: 'x',
      password: 'S3cure!pass',
      confirmPassword: 'S3cure!pass',
      locale: 'en',
    },
    {
      invitationId,
      revision: 0,
      name: 'x',
      password: 'S3cure!pass',
      confirmPassword: 'S3cure!pass',
      locale: 'en',
    },
    {
      invitationId,
      revision: 1.5,
      name: 'x',
      password: 'S3cure!pass',
      confirmPassword: 'S3cure!pass',
      locale: 'en',
    },
    {
      invitationId,
      revision: 2,
      name: '   ',
      password: 'S3cure!pass',
      confirmPassword: 'S3cure!pass',
      locale: 'en',
    },
    {
      invitationId,
      revision: 2,
      name: 'x',
      password: 'short',
      confirmPassword: 'short',
      locale: 'en',
    },
    {
      invitationId,
      revision: 2,
      name: 'x',
      password: 'S3cure!pass',
      confirmPassword: 'different',
      locale: 'en',
    },
    {
      invitationId,
      revision: 2,
      name: 'x',
      password: 'S3cure!pass',
      confirmPassword: 'S3cure!pass',
      locale: 'fr',
    },
  ] as Record<string, unknown>[])
    assert.equal(acceptanceBody(body), null, JSON.stringify(body));
});

test('the landing read accepts a cookie session or the two bounded fragments', () => {
  assert.deepEqual(acceptanceSessionBody({}), { kind: 'cookie' });
  assert.deepEqual(
    acceptanceSessionBody({ accessToken: 'jwt', refreshToken: 'rt' }),
    { kind: 'tokens', accessToken: 'jwt', refreshToken: 'rt' },
  );
  for (const body of [
    { accessToken: 'jwt' },
    { refreshToken: 'rt' },
    { accessToken: 'jwt', refreshToken: 'rt', type: 'invite' },
    { accessToken: '', refreshToken: 'rt' },
    { accessToken: 'jwt', refreshToken: '' },
    { accessToken: 1, refreshToken: 'rt' },
    { accessToken: 'a'.repeat(4097), refreshToken: 'rt' },
    null,
  ] as unknown as Record<string, unknown>[])
    assert.equal(acceptanceSessionBody(body), null, JSON.stringify(body));
});
