import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPLOYEE_ROLES,
  InvitationError,
  INVITATION_PATH,
  administerInvitation,
  attemptInvitationSend,
  invitationBody,
  invitationDestination,
  invitationFailure,
  invitationFromRow,
  invitationProblemAfterLoad,
  invitationQuery,
  invitationStatus,
  normalizeEmail,
  parseInvitation,
  providerInviteResult,
  type EmployeeInvitation,
  type InvitationGateway,
  type InvitationProviderResult,
  type InvitationSender,
} from './invitation.ts';

const employeeId = '10000000-0000-4000-8000-000000000001';
const actorId = '10000000-0000-4000-8000-000000000002';
const invitationId = '30000000-0000-4000-8000-000000000001';
const key = '50000000-0000-4000-8000-000000000001';
const providerUserId = '90000000-0000-4000-8000-0000000000aa';
// Assembled at run time so this public repository never carries a credential-shaped literal.
const secretPlaceholder = ['sb', 'secret'].join('_') + '_test-placeholder';

function invitation(
  patch: Partial<EmployeeInvitation> = {},
): EmployeeInvitation {
  return {
    id: invitationId,
    employeeId,
    actorId,
    email: 'invitee@example.test',
    role: 'sales',
    state: 'provider_pending',
    revision: 1,
    providerOutcome: null,
    providerDetail: null,
    providerAttemptedAt: null,
    requestedAt: '2026-10-15T09:00:00+07:00',
    recordedAt: null,
    ...patch,
  };
}

test('one normalized address is recorded and retyped input cannot change it', () => {
  assert.equal(
    normalizeEmail('  Invitee@Example.Test '),
    'invitee@example.test',
  );
  for (const value of [
    '',
    '   ',
    'not-an-email',
    'two@@example.test',
    'a b@example.test',
    `${'x'.repeat(250)}@example.test`,
    null,
    42,
  ])
    assert.equal(normalizeEmail(value), null, JSON.stringify(value));
});

test('the request accepts exactly one email, one existing role and one key', () => {
  assert.deepEqual(
    invitationBody({
      email: ' Invitee@Example.Test ',
      role: 'manager',
      key,
    }),
    { email: 'invitee@example.test', role: 'manager', key },
  );
  for (const body of [
    {},
    { email: 'invitee@example.test', role: 'sales' },
    { email: 'invitee@example.test', role: 'sales', key, actorId },
    { email: 'invitee@example.test', role: 'owner', key },
    { email: 'not-an-email', role: 'sales', key },
    { email: 'invitee@example.test', role: 'sales', key: 'not-a-uuid' },
  ] as Record<string, unknown>[])
    assert.equal(invitationBody(body), null, JSON.stringify(body));
  assert.deepEqual([...EMPLOYEE_ROLES], ['sales', 'staff', 'manager', 'admin']);
});

test('the reconciliation read accepts one normalized address and nothing else', () => {
  assert.equal(
    invitationQuery(new URLSearchParams({ email: ' Invitee@Example.Test ' })),
    'invitee@example.test',
  );
  for (const query of [
    {},
    { email: 'not-an-email' },
    { email: 'invitee@example.test', after: key },
    { email: 'invitee@example.test', extra: '1' },
  ] as Record<string, string>[])
    assert.throws(
      () => invitationQuery(new URLSearchParams(query)),
      InvitationError,
      JSON.stringify(query),
    );
  assert.throws(
    () =>
      invitationQuery(
        new URLSearchParams([
          ['email', 'invitee@example.test'],
          ['email', 'other@example.test'],
        ]),
      ),
    InvitationError,
  );
});

test('a recorded invitation is revalidated at the boundary', () => {
  assert.deepEqual(parseInvitation(invitation()), invitation());
  assert.deepEqual(
    parseInvitation(
      invitation({
        state: 'recorded',
        revision: 2,
        providerOutcome: 'accepted',
        recordedAt: '2026-10-15T09:05:00+07:00',
      }),
    ),
    invitation({
      state: 'recorded',
      revision: 2,
      providerOutcome: 'accepted',
      recordedAt: '2026-10-15T09:05:00+07:00',
    }),
  );
  assert.deepEqual(
    parseInvitation(
      invitation({
        state: 'provider_failed',
        revision: 3,
        providerOutcome: 'ambiguous',
        providerDetail: 'provider request did not complete',
      }),
    )?.providerOutcome,
    'ambiguous',
  );
  for (const value of [
    null,
    [],
    'recorded',
    invitation({ id: 'not-a-uuid' }),
    invitation({ employeeId: 'not-a-uuid' }),
    invitation({ email: 'not-an-email' }),
    invitation({ role: 'owner' as 'sales' }),
    invitation({ state: 'sent' as 'recorded' }),
    invitation({ revision: 0 }),
    invitation({ revision: 1.5 }),
    invitation({ state: 'recorded', recordedAt: null }),
    // The table checks are re-enforced here, not merely trusted.
    invitation({
      state: 'recorded',
      providerOutcome: null,
      recordedAt: '2026-10-15T09:05:00Z',
    }),
    invitation({ state: 'provider_pending', providerOutcome: 'accepted' }),
    invitation({ state: 'provider_failed', providerOutcome: 'accepted' }),
    invitation({ state: 'provider_failed', providerOutcome: null }),
    invitation({ requestedAt: 'not-an-instant' }),
    invitation({
      state: 'recorded',
      providerOutcome: 'accepted',
      recordedAt: 'not-an-instant',
    }),
  ])
    assert.equal(parseInvitation(value), null, JSON.stringify(value));
});

test('a database row is read back through the same boundary rules', () => {
  const row = {
    id: invitationId,
    employee_id: employeeId,
    actor_id: actorId,
    email: 'invitee@example.test',
    role: 'sales',
    state: 'recorded',
    revision: 2,
    provider_outcome: 'accepted',
    provider_detail: null,
    provider_attempted_at: '2026-10-15T09:04:00+07:00',
    requested_at: '2026-10-15T09:00:00+07:00',
    recorded_at: '2026-10-15T09:05:00+07:00',
  };
  assert.deepEqual(
    invitationFromRow(row),
    invitation({
      state: 'recorded',
      revision: 2,
      providerOutcome: 'accepted',
      providerAttemptedAt: '2026-10-15T09:04:00+07:00',
      recordedAt: '2026-10-15T09:05:00+07:00',
    }),
  );
  assert.equal(
    invitationFromRow({
      ...row,
      state: 'provider_failed',
      provider_outcome: null,
      recorded_at: null,
    }),
    null,
  );
});

test('the invitation status never presents a pending or failed send as recorded', () => {
  assert.equal(invitationStatus(null), 'none');
  assert.equal(invitationStatus(invitation()), 'pending');
  assert.equal(
    invitationStatus(
      invitation({ state: 'provider_failed', providerOutcome: 'failed' }),
    ),
    'reconciliation',
  );
  assert.equal(
    invitationStatus(
      invitation({
        state: 'recorded',
        providerOutcome: 'accepted',
        recordedAt: '2026-10-15T09:05:00Z',
      }),
    ),
    'recorded',
  );
});

test('an accepted request needs the exact intended provider identity', () => {
  assert.deepEqual(
    providerInviteResult(
      {
        user: { id: providerUserId, email: 'invitee@example.test' },
        error: null,
      },
      'invitee@example.test',
    ),
    { outcome: 'accepted', providerUserId },
  );
  // A different address, a missing identity or an unreadable one is ambiguous, never accepted.
  assert.equal(
    providerInviteResult(
      {
        user: { id: providerUserId, email: 'other@example.test' },
        error: null,
      },
      'invitee@example.test',
    ).outcome,
    'ambiguous',
  );
  assert.equal(
    providerInviteResult({ user: null, error: null }, 'invitee@example.test')
      .outcome,
    'ambiguous',
  );
  assert.equal(
    providerInviteResult(
      {
        user: { id: 'not-a-uuid', email: 'invitee@example.test' },
        error: null,
      },
      'invitee@example.test',
    ).outcome,
    'ambiguous',
  );
  // A definite provider refusal stays failed; an absent status may have been accepted.
  assert.equal(
    providerInviteResult(
      {
        user: null,
        error: { status: 422, message: 'user already registered' },
      },
      'invitee@example.test',
    ).outcome,
    'failed',
  );
  assert.equal(
    providerInviteResult(
      {
        user: null,
        error: { message: `upstream refused ${secretPlaceholder}` },
      },
      'invitee@example.test',
    ).outcome,
    'ambiguous',
  );
});

test('provider failure evidence is bounded and never carries a key', () => {
  const ambiguous = providerInviteResult(
    {
      user: null,
      error: { status: 502, message: `failed with ${secretPlaceholder}` },
    },
    'invitee@example.test',
  );
  assert.deepEqual(ambiguous, {
    outcome: 'ambiguous',
    detail: 'failed with [redacted]',
  });
});

test('the invitation destination is a fixed application path', () => {
  assert.equal(INVITATION_PATH, '/auth/invite');
  assert.equal(
    invitationDestination('https://app.example.test'),
    'https://app.example.test/auth/invite',
  );
  // A caller cannot move the destination: only the configured origin is used.
  assert.equal(
    invitationDestination('https://app.example.test/'),
    'https://app.example.test/auth/invite',
  );
});

test('the invitation is sent to the recorded address and its outcome is recorded', async () => {
  const sent: string[] = [];
  const recorded: InvitationProviderResult[] = [];
  const gateway: InvitationGateway = {
    async begin() {
      return invitation({ email: 'recorded@example.test' });
    },
    async record(request) {
      recorded.push(request.result);
      assert.equal(request.email, 'recorded@example.test');
      assert.equal(request.actorId, actorId);
      assert.equal(request.invitationId, invitationId);
      assert.equal(request.revision, 1);
      return invitation({
        email: 'recorded@example.test',
        state: 'recorded',
        revision: 2,
        providerOutcome: 'accepted',
        recordedAt: '2026-10-15T09:05:00Z',
      });
    },
  };
  const sender: InvitationSender = {
    async send(request) {
      sent.push(request.email);
      return { outcome: 'accepted', providerUserId };
    },
  };
  const result = await administerInvitation(gateway, sender, {
    email: 'invitee@example.test',
    role: 'sales',
    key,
    actorId,
  });
  assert.deepEqual(sent, ['recorded@example.test']);
  assert.deepEqual(recorded, [{ outcome: 'accepted', providerUserId }]);
  assert.equal(invitationStatus(result), 'recorded');
});

test('a recorded invitation is never re-sent and a failed sender stays reconcilable', async () => {
  let sends = 0;
  const sender: InvitationSender = {
    async send() {
      sends += 1;
      return { outcome: 'accepted', providerUserId };
    },
  };
  const settled: InvitationGateway = {
    async begin() {
      return invitation({
        state: 'recorded',
        providerOutcome: 'accepted',
        recordedAt: '2026-10-15T09:05:00Z',
      });
    },
    async record() {
      throw new Error('a recorded invitation must not be recorded again');
    },
  };
  const alreadySent = await administerInvitation(settled, sender, {
    email: 'invitee@example.test',
    role: 'sales',
    key,
    actorId,
  });
  assert.equal(sends, 0, 'nothing is re-sent for a recorded invitation');
  assert.equal(invitationStatus(alreadySent), 'recorded');

  const outcomes: InvitationProviderResult[] = [];
  const reconciling: InvitationGateway = {
    async begin() {
      return invitation();
    },
    async record(request) {
      outcomes.push(request.result);
      return invitation({
        state: 'provider_failed',
        revision: 2,
        providerOutcome: 'ambiguous',
      });
    },
  };
  const failing: InvitationSender = {
    async send() {
      throw new Error('transport closed');
    },
  };
  await administerInvitation(reconciling, failing, {
    email: 'invitee@example.test',
    role: 'sales',
    key,
    actorId,
  });
  assert.deepEqual(outcomes, [
    { outcome: 'ambiguous', detail: 'transport closed' },
  ]);
  assert.deepEqual(
    await attemptInvitationSend(failing, { email: 'invitee@example.test' }),
    { outcome: 'ambiguous', detail: 'transport closed' },
  );
});

test('only a definitively refused action stops reconciling', () => {
  assert.deepEqual(invitationFailure(null), {
    code: 'unavailable',
    ambiguous: true,
  });
  assert.deepEqual(
    invitationFailure({ status: 409, code: 'invitation-role-conflict' }),
    { code: 'invitation-role-conflict', ambiguous: false },
  );
  for (const failure of [
    { status: 503, code: 'unavailable' },
    { code: 'unavailable' },
    { status: 500, code: 'invitation-changed' },
  ])
    assert.equal(invitationFailure(failure).ambiguous, true);
  assert.equal(
    invitationProblemAfterLoad({
      code: 'invitation-email-recorded',
      ambiguous: false,
    })?.code,
    'invitation-email-recorded',
  );
  assert.equal(
    invitationProblemAfterLoad({ code: 'unavailable', ambiguous: true }),
    null,
  );
});
