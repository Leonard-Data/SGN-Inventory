import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPLOYEE_NAME_MAX_LENGTH,
  acceptanceBody,
  acceptanceName,
  acceptancePassword,
  acceptanceSessionBody,
  parseAcceptedEmployee,
} from './invitation-acceptance.ts';

const invitationId = '30000000-0000-4000-8000-000000000001';
const employeeId = '10000000-0000-4000-8000-000000000001';

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

test('the RPC projection is revalidated at the boundary', () => {
  assert.deepEqual(
    parseAcceptedEmployee({
      id: employeeId,
      displayName: '  Nguyễn Văn Ẩn  ',
      email: 'invitee@example.test',
      role: 'manager',
      locale: 'vi',
    }),
    {
      id: employeeId,
      displayName: 'Nguyễn Văn Ẩn',
      email: 'invitee@example.test',
      role: 'manager',
      locale: 'vi',
    },
  );
  assert.equal(
    parseAcceptedEmployee({
      id: employeeId,
      displayName: 'Nguyễn Văn Ẩn',
      email: 'invitee@example.test',
      role: 'manager',
      locale: 'fr',
    })?.locale,
    'vi',
  );
  for (const value of [
    null,
    [],
    'accepted',
    { id: 'not-a-uuid', displayName: 'x', email: 'a@b.test', role: 'sales' },
    { id: employeeId, displayName: '   ', email: 'a@b.test', role: 'sales' },
    { id: employeeId, displayName: 'x', email: 'not-an-email', role: 'sales' },
    { id: employeeId, displayName: 'x', email: 'a@b.test', role: 'owner' },
  ])
    assert.equal(parseAcceptedEmployee(value), null, JSON.stringify(value));
});
