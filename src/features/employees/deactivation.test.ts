import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  administerDeactivation,
  attemptSignInBlock,
  deactivationKey,
  deactivationStatus,
  mayAdministerEmployees,
  outstandingReservations,
  parseDeactivationOperation,
  providerBanResult,
  providerDetail,
  providerServiceKey,
  type DeactivationGateway,
  type DeactivationOperation,
  type SignInBlocker,
} from './deactivation.ts';

const employeeId = '10000000-0000-4000-8000-000000000001';
const actorId = '10000000-0000-4000-8000-000000000002';
const operationId = '30000000-0000-4000-8000-000000000001';
const authUserId = '90000000-0000-4000-8000-0000000000aa';
const key = '50000000-0000-4000-8000-000000000001';

function operation(
  patch: Partial<DeactivationOperation> = {},
): DeactivationOperation {
  return {
    id: operationId,
    employeeId,
    actorId,
    kind: 'deactivate',
    state: 'provider_pending',
    revision: 1,
    providerOutcome: null,
    providerDetail: null,
    providerBanUntil: null,
    membershipDisabledAt: '2026-10-13T09:00:00+07:00',
    completedAt: null,
    ...patch,
  };
}

function gateway(
  begin: DeactivationGateway['begin'],
  record: DeactivationGateway['record'],
): { calls: string[]; gateway: DeactivationGateway } {
  const calls: string[] = [];
  return {
    calls,
    gateway: {
      begin: async (...args) => {
        calls.push('begin');
        return begin(...args);
      },
      record: async (...args) => {
        calls.push('record');
        return record(...args);
      },
    },
  };
}

test('only exactly one UUID submission key is accepted from the browser', () => {
  assert.equal(deactivationKey({ key }), key);
  for (const body of [
    {},
    { key: 'not-a-uuid' },
    { key: '' },
    { key, employeeId },
    { key, outcome: 'blocked' },
  ])
    assert.equal(deactivationKey(body), null, JSON.stringify(body));
});

test('a malformed recorded operation is never rendered as a state', () => {
  assert.equal(
    parseDeactivationOperation({
      id: operationId,
      employeeId,
      actorId,
      kind: 'deactivate',
      state: 'provider_pending',
      revision: 1,
      providerOutcome: null,
      providerDetail: null,
      providerBanUntil: null,
      membershipDisabledAt: '2026-10-13T09:00:00+07:00',
      completedAt: null,
    })?.state,
    'provider_pending',
  );
  for (const patch of [
    { id: 'bad' },
    { state: 'done' },
    { revision: 0 },
    { revision: 1.5 },
    { kind: 'activate' },
    { providerOutcome: 'accepted' },
    { membershipDisabledAt: null },
    { state: 'completed' },
    { state: 'provider_failed', completedAt: '2026-10-13T09:00:00+07:00' },
  ])
    assert.equal(
      parseDeactivationOperation({
        id: operationId,
        employeeId,
        actorId,
        kind: 'deactivate',
        state: 'provider_pending',
        revision: 1,
        providerOutcome: null,
        providerDetail: null,
        providerBanUntil: null,
        membershipDisabledAt: '2026-10-13T09:00:00+07:00',
        completedAt: null,
        ...patch,
      }),
      null,
      JSON.stringify(patch),
    );
});

test('outstanding reservations separate effective and pending and never reassign them', () => {
  const now = new Date('2026-10-13T00:00:00Z');
  const rows = [
    {
      id: 'lock-pending',
      property_id: 'property-1',
      status: 'pending',
      expires_at: '2026-10-15T00:00:00Z',
      properties: { property_code: 'SGN-PEN' },
    },
    {
      id: 'lock-effective',
      property_id: 'property-2',
      status: 'approved',
      expires_at: '2026-10-14T00:00:00Z',
      properties: { property_code: 'SGN-EFF' },
    },
    {
      id: 'lock-expired',
      property_id: 'property-3',
      status: 'approved',
      expires_at: '2026-10-12T00:00:00Z',
      properties: { property_code: 'SGN-OLD' },
    },
    {
      id: 'lock-released',
      property_id: 'property-4',
      status: 'released',
      expires_at: '2026-10-20T00:00:00Z',
      properties: { property_code: 'SGN-REL' },
    },
  ];
  const reservations = outstandingReservations(rows, now);
  assert.deepEqual(
    reservations.map((reservation) => [reservation.id, reservation.kind]),
    [
      ['lock-effective', 'effective'],
      ['lock-pending', 'pending'],
    ],
  );
  assert.equal(reservations[0]!.propertyCode, 'SGN-EFF');
});

test('the list status distinguishes pending, reconciliation and confirmed', () => {
  assert.equal(deactivationStatus(null), 'none');
  assert.equal(deactivationStatus(operation()), 'pending');
  assert.equal(
    deactivationStatus(
      operation({ state: 'provider_failed', providerOutcome: 'failed' }),
    ),
    'reconciliation',
  );
  assert.equal(
    deactivationStatus(
      operation({
        state: 'completed',
        providerOutcome: 'blocked',
        completedAt: '2026-10-13T10:00:00+07:00',
      }),
    ),
    'confirmed',
  );
});

test('only the admin role may administer employee deactivation', () => {
  assert.equal(mayAdministerEmployees('admin'), true);
  for (const role of ['manager', 'staff', 'sales', ''])
    assert.equal(mayAdministerEmployees(role), false, role);
});

test('the provider secret must be a service-role credential, never a publishable key', () => {
  const serviceJwt = [
    'header',
    Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url'),
    'signature',
  ].join('.');
  const anonJwt = [
    'header',
    Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url'),
    'signature',
  ].join('.');
  assert.equal(
    providerServiceKey({ SUPABASE_SERVICE_ROLE_KEY: serviceJwt }),
    serviceJwt,
  );
  assert.equal(
    providerServiceKey({ SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_abc123' }),
    'sb_secret_abc123',
  );
  for (const value of [
    undefined,
    '',
    '   ',
    'YOUR_SERVICE_ROLE_KEY',
    'sb_publishable_abc123',
    anonJwt,
    'eyJhbGciOiJIUzI1NiJ9.bm90LWpzb24.sig',
    'not-a-key',
  ])
    assert.equal(
      providerServiceKey({ SUPABASE_SERVICE_ROLE_KEY: value }),
      null,
      String(value),
    );
});

test('only a confirmed identity and ban expiry is reported as blocked', () => {
  assert.deepEqual(
    providerBanResult({
      user: { id: authUserId, banned_until: '2126-10-13T00:00:00Z' },
      error: null,
    }),
    {
      outcome: 'blocked',
      reference: authUserId,
      banUntil: '2126-10-13T00:00:00Z',
    },
  );
  assert.equal(
    providerBanResult({
      user: { id: authUserId, banned_until: null },
      error: null,
    }).outcome,
    'ambiguous',
  );
  assert.equal(
    providerBanResult({
      user: null,
      error: { status: 422, message: 'invalid user' },
    }).outcome,
    'failed',
  );
  assert.equal(
    providerBanResult({
      user: null,
      error: { status: 503, message: 'unavailable' },
    }).outcome,
    'ambiguous',
  );
  assert.equal(
    providerBanResult({ user: null, error: { status: 0, message: '' } })
      .outcome,
    'ambiguous',
  );
});

test('provider evidence is redacted and bounded before it is recorded', () => {
  const redacted = providerDetail(
    new Error(
      'request failed with eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature and sb_secret_shouldneverappear',
    ),
  );
  assert.ok(!redacted.includes('eyJhbGciOiJIUzI1NiJ9'));
  assert.ok(!redacted.includes('shouldneverappear'));
  assert.ok(redacted.includes('[redacted]'));
  const bounded = providerDetail(new Error('x'.repeat(600)));
  assert.equal(bounded.length, 500);
  assert.equal(
    providerDetail(new Error('')),
    'provider request did not complete',
  );
});

test('a completed operation is terminal and never re-attempts the provider', async () => {
  let blocked = 0;
  const fake = gateway(
    async () =>
      operation({
        state: 'completed',
        providerOutcome: 'blocked',
        providerBanUntil: '2126-10-13T00:00:00Z',
        completedAt: '2026-10-13T10:00:00+07:00',
      }),
    async () => {
      throw new Error('record must not run');
    },
  );
  const blocker: SignInBlocker = {
    block: async () => {
      blocked++;
      return { outcome: 'blocked', reference: authUserId, banUntil: 'x' };
    },
  };
  const result = await administerDeactivation(fake.gateway, blocker, {
    employeeId,
    authUserId,
    actorId,
    key,
  });
  assert.equal(result.state, 'completed');
  assert.deepEqual(fake.calls, ['begin']);
  assert.equal(blocked, 0);
});

test('a confirmed provider block is recorded against the same revision', async () => {
  const fake = gateway(
    async () => operation(),
    async (request) => {
      assert.equal(request.operationId, operationId);
      assert.equal(request.revision, 1);
      assert.equal(request.actorId, actorId);
      assert.equal(request.authUserId, authUserId);
      return operation({
        state: 'completed',
        revision: 2,
        providerOutcome: 'blocked',
        providerBanUntil: '2126-10-13T00:00:00Z',
        completedAt: '2026-10-13T10:00:00+07:00',
      });
    },
  );
  const blocker: SignInBlocker = {
    block: async (request) => {
      assert.equal(request.employeeId, employeeId);
      assert.equal(request.authUserId, authUserId);
      return {
        outcome: 'blocked',
        reference: authUserId,
        banUntil: '2126-10-13T00:00:00Z',
      };
    },
  };
  const result = await administerDeactivation(fake.gateway, blocker, {
    employeeId,
    authUserId,
    actorId,
    key,
  });
  assert.equal(result.state, 'completed');
  assert.deepEqual(fake.calls, ['begin', 'record']);
});

test('a failed or thrown provider attempt is recorded and never completes', async () => {
  const failures = [
    { outcome: 'failed' as const, detail: 'rejected' },
    { outcome: 'ambiguous' as const, detail: 'timed out' },
  ];
  for (const result of failures) {
    const expected = result.outcome === 'ambiguous' ? 'ambiguous' : 'failed';
    const fake = gateway(
      async () => operation(),
      async (request) => {
        assert.deepEqual(request.result, result);
        return operation({
          state: 'provider_failed',
          revision: 2,
          providerOutcome: expected,
          providerDetail: result.detail,
        });
      },
    );
    const blocker: SignInBlocker = { block: async () => result };
    const recorded = await administerDeactivation(fake.gateway, blocker, {
      employeeId,
      authUserId,
      actorId,
      key,
    });
    assert.equal(recorded.state, 'provider_failed');
  }
});

test('an unexpected provider failure becomes a recorded failure with safe detail', async () => {
  const fake = gateway(
    async () => operation(),
    async (request) => {
      assert.equal(request.result.outcome, 'failed');
      assert.ok(request.result.detail.length <= 500);
      return operation({
        state: 'provider_failed',
        revision: 2,
        providerOutcome: 'failed',
        providerDetail: request.result.detail,
      });
    },
  );
  const blocker: SignInBlocker = {
    block: async () => {
      throw new Error('socket closed with sb_secret_shouldneverappear');
    },
  };
  const recorded = await administerDeactivation(fake.gateway, blocker, {
    employeeId,
    authUserId,
    actorId,
    key,
  });
  assert.equal(recorded.state, 'provider_failed');
  const detail = await attemptSignInBlock(blocker, { employeeId, authUserId });
  assert.ok(!JSON.stringify(detail).includes('shouldneverappear'));
});

test('a refused begin or record surfaces instead of being read as success', async () => {
  const refused = gateway(
    async () => {
      throw new Error('deactivation-key-conflict');
    },
    async () => {
      throw new Error('unreachable');
    },
  );
  await assert.rejects(
    administerDeactivation(
      refused.gateway,
      {
        block: async () => ({
          outcome: 'blocked',
          reference: 'x',
          banUntil: 'x',
        }),
      },
      { employeeId, authUserId, actorId, key },
    ),
    /deactivation-key-conflict/,
  );
  const recordFailed = gateway(
    async () => operation(),
    async () => {
      throw new Error('stale-operation');
    },
  );
  await assert.rejects(
    administerDeactivation(
      recordFailed.gateway,
      {
        block: async () => ({
          outcome: 'blocked',
          reference: 'x',
          banUntil: 'x',
        }),
      },
      { employeeId, authUserId, actorId, key },
    ),
    /stale-operation/,
  );
});
