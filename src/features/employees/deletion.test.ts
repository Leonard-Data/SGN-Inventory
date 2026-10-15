import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  accountDeletionResult,
  accountPresence,
  administerAccountDeletion,
  deletionKey,
  deletionResumable,
  deletionStatus,
  parseDeletionOperation,
  parseStoragePreflight,
  parseStorageReassignment,
  reassignOwnedStorage,
  type AccountDeletionGateway,
  type AccountDeletionProvider,
  type AccountDeletionResult,
  type AccountPresence,
  type DeletionOperation,
  type DeletionRecordRequest,
  type StoragePreflight,
  type StorageReassignment,
} from './deletion.ts';

const employeeId = '11000000-0000-4000-8000-000000000001';
const actorId = '11000000-0000-4000-8000-000000000002';
const authUserId = '11000000-0000-4000-8000-0000000000f1';
const custodianId = '11000000-0000-4000-8000-0000000000f2';

function operation(patch: Partial<DeletionOperation> = {}): DeletionOperation {
  return {
    id: randomUUID(),
    employeeId,
    actorId,
    kind: 'delete',
    state: 'provider_pending',
    revision: 1,
    providerOutcome: null,
    providerDetail: null,
    targetAuthUserId: authUserId,
    storageOwnedCount: null,
    storageReassignedCount: null,
    membershipDisabledAt: '2026-10-15T04:00:00Z',
    completedAt: null,
    ...patch,
  };
}

// A gateway that records exactly what the orchestration asked it to record, so a fault can be
// injected at any provider step and the recorded result inspected.
function gateway(beginResult: DeletionOperation) {
  const recorded: DeletionRecordRequest[] = [];
  let begins = 0;
  let current = beginResult;
  const value: AccountDeletionGateway = {
    async begin() {
      begins += 1;
      return current;
    },
    async record(request) {
      recorded.push(request);
      const outcome = request.result.outcome;
      current = operation({
        id: beginResult.id,
        revision: request.revision + 1,
        state: outcome === 'deleted' ? 'completed' : 'provider_failed',
        providerOutcome: outcome,
        storageOwnedCount: request.storageOwned,
        storageReassignedCount: request.storageReassigned,
        completedAt: outcome === 'deleted' ? '2026-10-15T05:00:00Z' : null,
      });
      return current;
    },
  };
  return { value, recorded, begins: () => begins };
}

function provider(overrides: Partial<AccountDeletionProvider> = {}) {
  const calls: string[] = [];
  const value: AccountDeletionProvider = {
    async preflight() {
      calls.push('preflight');
      return { supported: true, ownedCount: 0 };
    },
    async reassignStorageOwnership() {
      calls.push('reassign');
      return { supported: true, reassignedCount: 0 };
    },
    async deleteAccount() {
      calls.push('delete');
      return { outcome: 'deleted', reference: authUserId };
    },
    async accountPresence() {
      calls.push('presence');
      return 'present';
    },
    ...overrides,
  };
  return { value, calls };
}

const input = () => ({
  employeeId,
  custodianAuthUserId: custodianId,
  actorId,
  key: randomUUID(),
});

test('the projection is revalidated and a malformed operation is never rendered', () => {
  const valid = {
    id: randomUUID(),
    employeeId,
    actorId,
    kind: 'delete',
    state: 'provider_pending',
    revision: 1,
    providerOutcome: null,
    providerDetail: null,
    targetAuthUserId: authUserId,
    storageOwnedCount: null,
    storageReassignedCount: null,
    membershipDisabledAt: '2026-10-15T04:00:00Z',
    completedAt: null,
  };
  assert.deepEqual(parseDeletionOperation(valid), {
    ...valid,
    kind: 'delete',
  });
  for (const patch of [
    { kind: 'deactivate' },
    { state: 'unsupported' },
    { targetAuthUserId: null },
    { targetAuthUserId: 'not-a-uuid' },
    { targetAuthUserId: undefined },
    { revision: 0 },
    { providerOutcome: 'blocked' },
    { completedAt: '2026-10-15T05:00:00Z' },
    { membershipDisabledAt: 'nope' },
    { storageOwnedCount: -1 },
  ])
    assert.equal(
      parseDeletionOperation({ ...valid, ...patch }),
      null,
      JSON.stringify(patch),
    );
  assert.equal(parseDeletionOperation(null), null);
});

test('a captured but unconfirmed account is ambiguous, never deleted', () => {
  assert.deepEqual(
    accountDeletionResult({ user: null, error: { status: 400, message: 'x' } }),
    { outcome: 'failed', detail: 'x' },
  );
  assert.equal(
    accountDeletionResult({
      user: null,
      error: { status: 500, message: 'x' },
    }).outcome,
    'ambiguous',
  );
  assert.deepEqual(accountDeletionResult({ user: { id: 'x' }, error: null }), {
    outcome: 'deleted',
    reference: 'x',
  });
  assert.equal(
    accountDeletionResult({ user: null, error: null }).outcome,
    'ambiguous',
  );
});

test('only a 404 is an absent account; an unreadable answer is unknown', () => {
  assert.equal(accountPresence({ user: { id: 'x' }, error: null }), 'present');
  assert.equal(accountPresence({ user: null, error: null }), 'absent');
  assert.equal(
    accountPresence({ user: null, error: { status: 404 } }),
    'absent',
  );
  assert.equal(
    accountPresence({ user: null, error: { status: 429 } }),
    'unknown',
  );
  assert.equal(accountPresence({ user: null, error: {} }), 'unknown');
});

test('the deletion status distinguishes every recorded state', () => {
  assert.equal(deletionStatus(null), 'none');
  assert.equal(deletionStatus(operation()), 'pending');
  assert.equal(
    deletionStatus(
      operation({ state: 'provider_failed', providerOutcome: 'failed' }),
    ),
    'reconciliation',
  );
  assert.equal(
    deletionStatus(
      operation({
        state: 'provider_failed',
        providerOutcome: 'storage_blocked',
      }),
    ),
    'storage-blocked',
  );
  assert.equal(
    deletionStatus(
      operation({
        state: 'completed',
        providerOutcome: 'deleted',
        completedAt: 'x',
      }),
    ),
    'confirmed',
  );
  assert.equal(deletionResumable(null), false);
  assert.equal(
    deletionResumable(
      operation({
        state: 'provider_failed',
        providerOutcome: 'storage_blocked',
      }),
    ),
    true,
  );
  assert.equal(
    deletionResumable(
      operation({
        state: 'completed',
        providerOutcome: 'deleted',
        completedAt: 'x',
      }),
    ),
    false,
  );
});

test('the submission body is exactly one action key', () => {
  const key = randomUUID();
  assert.equal(deletionKey({ key }), key);
  assert.equal(deletionKey({ key, employeeId }), null);
  assert.equal(deletionKey({ key: 'nope' }), null);
  assert.equal(deletionKey({}), null);
});

test('provider payloads are revalidated rather than trusted', () => {
  assert.deepEqual(parseStoragePreflight({ supported: true, ownedCount: 3 }), {
    supported: true,
    ownedCount: 3,
  });
  for (const value of [
    null,
    {},
    { supported: 'yes', ownedCount: 0 },
    { supported: true },
    { supported: true, ownedCount: -2 },
    { supported: true, ownedCount: 1.5 },
  ])
    assert.equal(parseStoragePreflight(value), null, JSON.stringify(value));
  assert.deepEqual(
    parseStorageReassignment({ supported: true, reassignedCount: 2 }),
    { supported: true, reassignedCount: 2 },
  );
  assert.equal(parseStorageReassignment({ supported: true }), null);
});

test('a preflight that cannot be verified leaves a truthful partial state', async () => {
  const unsupported = await reassignOwnedStorage(
    provider({
      async preflight(): Promise<StoragePreflight> {
        return { supported: false, ownedCount: 0 };
      },
    }).value,
    authUserId,
    custodianId,
  );
  assert.equal(unsupported.blocked, true);
  assert.equal(unsupported.ownedCount, null);

  const failed = await reassignOwnedStorage(
    provider({
      async preflight(): Promise<StoragePreflight> {
        throw new Error('preflight down');
      },
    }).value,
    authUserId,
    custodianId,
  );
  assert.equal(failed.blocked, true);
  assert.match(failed.detail!, /preflight down/);
});

test('owned objects are reassigned to the custodian and re-verified', async () => {
  const good = provider({
    async preflight(): Promise<StoragePreflight> {
      return { supported: true, ownedCount: 2 };
    },
    async reassignStorageOwnership(): Promise<StorageReassignment> {
      return { supported: true, reassignedCount: 2 };
    },
  });
  // Second preflight observes ownership moved away.
  let preflights = 0;
  good.value.preflight = async () => {
    preflights += 1;
    return preflights === 1
      ? { supported: true, ownedCount: 2 }
      : { supported: true, ownedCount: 0 };
  };
  const moved = await reassignOwnedStorage(good.value, authUserId, custodianId);
  assert.deepEqual(moved, {
    blocked: false,
    ownedCount: 2,
    reassignedCount: 2,
    detail: null,
  });
});

test('a blocked reassignment never records a deletion and never deletes files', async () => {
  const cases: [string, AccountDeletionProvider][] = [
    [
      'reassignment refused',
      provider({
        async preflight() {
          return { supported: true, ownedCount: 1 };
        },
        async reassignStorageOwnership(): Promise<StorageReassignment> {
          throw new Error('not permitted');
        },
      }).value,
    ],
    [
      'reassignment unsupported',
      provider({
        async preflight() {
          return { supported: true, ownedCount: 1 };
        },
        async reassignStorageOwnership(): Promise<StorageReassignment> {
          return { supported: false, reassignedCount: 0 };
        },
      }).value,
    ],
    [
      'objects still owned afterwards',
      provider({
        async preflight() {
          return { supported: true, ownedCount: 1 };
        },
        async reassignStorageOwnership(): Promise<StorageReassignment> {
          return { supported: true, reassignedCount: 1 };
        },
      }).value,
    ],
  ];
  for (const [name, value] of cases) {
    if (name === 'objects still owned afterwards') {
      // Preflight always reports the object still owned, so verification must fail closed.
      value.preflight = async () => ({ supported: true, ownedCount: 1 });
    }
    const g = gateway(operation());
    const result = await administerAccountDeletion(g.value, value, input());
    assert.equal(result.providerOutcome, 'storage_blocked', name);
    assert.equal(g.recorded.length, 1, name);
    assert.equal(g.recorded[0]!.result.outcome, 'storage_blocked', name);
    assert.equal(g.recorded[0]!.storageOwned, 1, name);
  }
});

test('a lost acknowledgment converges when the account is already absent', async () => {
  const p = provider({
    async accountPresence(): Promise<AccountPresence> {
      return 'absent';
    },
  });
  const g = gateway(operation());
  const result = await administerAccountDeletion(g.value, p.value, input());
  assert.equal(result.providerOutcome, 'deleted');
  // The already-absent account is confirmed without a second destructive provider call.
  assert.ok(!p.calls.includes('delete'));
  assert.equal(g.recorded[0]!.result.outcome, 'deleted');
  assert.equal(g.recorded[0]!.storageOwned, 0);
});

test('a completed deletion is returned as recorded without touching the provider', async () => {
  const p = provider();
  const g = gateway(
    operation({
      state: 'completed',
      providerOutcome: 'deleted',
      completedAt: 'x',
    }),
  );
  const result = await administerAccountDeletion(g.value, p.value, input());
  assert.equal(result.providerOutcome, 'deleted');
  assert.deepEqual(p.calls, []);
  assert.equal(g.recorded.length, 0);
});

test('deletion completes only after the absent account is confirmed', async () => {
  let presence = 0;
  const p = provider({
    async accountPresence(): Promise<AccountPresence> {
      presence += 1;
      return presence <= 1 ? 'present' : 'absent';
    },
  });
  const g = gateway(operation());
  const result = await administerAccountDeletion(g.value, p.value, input());
  assert.equal(result.providerOutcome, 'deleted');
  assert.deepEqual(g.recorded[0]!.result, {
    outcome: 'deleted',
    reference: authUserId,
  });
});

test('a provider success without an absent confirmation stays a truthful partial state', async () => {
  const p = provider({
    async accountPresence(): Promise<AccountPresence> {
      return 'present';
    },
  });
  const g = gateway(operation());
  const result = await administerAccountDeletion(g.value, p.value, input());
  assert.equal(result.providerOutcome, 'ambiguous');
  assert.equal(g.recorded[0]!.result.outcome, 'ambiguous');
});

test('an ambiguous delete resolves by the recorded absence instead of guessing', async () => {
  let presence = 0;
  const p = provider({
    async deleteAccount(): Promise<AccountDeletionResult> {
      return { outcome: 'ambiguous', detail: 'transport reset' };
    },
    async accountPresence(): Promise<AccountPresence> {
      presence += 1;
      return presence <= 1 ? 'present' : 'absent';
    },
  });
  const g = gateway(operation());
  const result = await administerAccountDeletion(g.value, p.value, input());
  assert.equal(result.providerOutcome, 'deleted');
  assert.equal(g.recorded[0]!.result.outcome, 'deleted');
});

test('a definite refusal stays failed while the account is still present', async () => {
  const p = provider({
    async deleteAccount(): Promise<AccountDeletionResult> {
      return { outcome: 'failed', detail: 'invalid request' };
    },
  });
  const g = gateway(operation());
  const result = await administerAccountDeletion(g.value, p.value, input());
  assert.equal(result.providerOutcome, 'failed');
  assert.deepEqual(g.recorded[0]!.result, {
    outcome: 'failed',
    detail: 'invalid request',
  });
  // The recorded state is resumable, so the admin can retry the same action.
  assert.equal(
    deletionResumable(
      operation({ state: 'provider_failed', providerOutcome: 'failed' }),
    ),
    true,
  );
});

test('a definite refusal whose account is gone is a completed deletion', async () => {
  let presence = 0;
  const p = provider({
    async deleteAccount(): Promise<AccountDeletionResult> {
      return { outcome: 'failed', detail: 'not found' };
    },
    async accountPresence(): Promise<AccountPresence> {
      presence += 1;
      return presence <= 1 ? 'present' : 'absent';
    },
  });
  const g = gateway(operation());
  const result = await administerAccountDeletion(g.value, p.value, input());
  assert.equal(result.providerOutcome, 'deleted');
});

test('the recorded Storage counts are reported with the outcome', async () => {
  let preflights = 0;
  const p = provider({
    async preflight(): Promise<StoragePreflight> {
      preflights += 1;
      return preflights === 1
        ? { supported: true, ownedCount: 4 }
        : { supported: true, ownedCount: 0 };
    },
    async reassignStorageOwnership(): Promise<StorageReassignment> {
      return { supported: true, reassignedCount: 4 };
    },
    async accountPresence(): Promise<AccountPresence> {
      return 'absent';
    },
  });
  const g = gateway(operation());
  await administerAccountDeletion(g.value, p.value, input());
  assert.equal(g.recorded[0]!.storageOwned, 4);
  assert.equal(g.recorded[0]!.storageReassigned, 4);
});

test('a resume that finds nothing left to move keeps the recorded Storage counts', async () => {
  const p = provider({
    async accountPresence(): Promise<AccountPresence> {
      return 'absent';
    },
  });
  // The earlier attempt already reassigned three objects and failed afterwards, so this
  // attempt's preflight reports none left; the completed evidence must keep the three.
  const g = gateway(
    operation({
      state: 'provider_failed',
      providerOutcome: 'ambiguous',
      revision: 2,
      storageOwnedCount: 3,
      storageReassignedCount: 3,
    }),
  );
  const result = await administerAccountDeletion(g.value, p.value, input());
  assert.equal(result.providerOutcome, 'deleted');
  assert.equal(g.recorded[0]!.storageOwned, 3);
  assert.equal(g.recorded[0]!.storageReassigned, 3);
});

test('a resume that still finds owned objects records the fresh counts', async () => {
  let preflights = 0;
  const p = provider({
    async preflight(): Promise<StoragePreflight> {
      preflights += 1;
      return preflights === 1
        ? { supported: true, ownedCount: 2 }
        : { supported: true, ownedCount: 0 };
    },
    async reassignStorageOwnership(): Promise<StorageReassignment> {
      return { supported: true, reassignedCount: 2 };
    },
    async accountPresence(): Promise<AccountPresence> {
      return 'absent';
    },
  });
  const g = gateway(
    operation({
      state: 'provider_failed',
      providerOutcome: 'ambiguous',
      revision: 2,
      storageOwnedCount: 5,
      storageReassignedCount: 5,
    }),
  );
  await administerAccountDeletion(g.value, p.value, input());
  assert.equal(g.recorded[0]!.storageOwned, 2);
  assert.equal(g.recorded[0]!.storageReassigned, 2);
});

test('an unsupported reassignment on resume keeps a recorded non-zero reassignment', async () => {
  const p = provider({
    async preflight(): Promise<StoragePreflight> {
      return { supported: true, ownedCount: 3 };
    },
    async reassignStorageOwnership(): Promise<StorageReassignment> {
      return { supported: false, reassignedCount: 0 };
    },
  });
  const g = gateway(
    operation({
      state: 'provider_failed',
      providerOutcome: 'ambiguous',
      revision: 2,
      storageOwnedCount: 3,
      storageReassignedCount: 3,
    }),
  );
  const result = await administerAccountDeletion(g.value, p.value, input());
  assert.equal(result.providerOutcome, 'storage_blocked');
  assert.equal(g.recorded[0]!.storageOwned, 3);
  assert.equal(g.recorded[0]!.storageReassigned, 3);
});

test('a transiently unverifiable Storage step cannot erase the recorded evidence', async () => {
  let preflights = 0;
  const p = provider({
    async preflight(): Promise<StoragePreflight> {
      preflights += 1;
      if (preflights === 1) return { supported: true, ownedCount: 3 };
      if (preflights <= 3) throw new Error('storage unavailable');
      return { supported: true, ownedCount: 0 };
    },
    async reassignStorageOwnership(): Promise<StorageReassignment> {
      return { supported: true, reassignedCount: 3 };
    },
    async accountPresence(): Promise<AccountPresence> {
      return 'absent';
    },
  });
  const g = gateway(operation());
  const first = await administerAccountDeletion(g.value, p.value, input());
  assert.equal(first.providerOutcome, 'storage_blocked');
  const second = await administerAccountDeletion(g.value, p.value, input());
  assert.equal(second.providerOutcome, 'storage_blocked');
  const third = await administerAccountDeletion(g.value, p.value, input());
  assert.equal(third.providerOutcome, 'deleted');
  for (const request of g.recorded) {
    assert.equal(request.storageOwned, 3);
    assert.equal(request.storageReassigned, 3);
  }
});

test('an unknown reassignment stays unknown when a resume converges', async () => {
  const p = provider({
    async preflight(): Promise<StoragePreflight> {
      return { supported: true, ownedCount: 0 };
    },
    async accountPresence(): Promise<AccountPresence> {
      return 'absent';
    },
  });
  // The earlier attempt saw three owned objects and never learned how many moved.
  const g = gateway(
    operation({
      state: 'provider_failed',
      providerOutcome: 'storage_blocked',
      revision: 2,
      storageOwnedCount: 3,
      storageReassignedCount: null,
    }),
  );
  const result = await administerAccountDeletion(g.value, p.value, input());
  assert.equal(result.providerOutcome, 'deleted');
  assert.equal(g.recorded[0]!.storageOwned, 3);
  assert.equal(g.recorded[0]!.storageReassigned, null);
});

test('an unsupported reassignment on resume keeps an unknown reassignment unknown', async () => {
  const p = provider({
    async preflight(): Promise<StoragePreflight> {
      return { supported: true, ownedCount: 3 };
    },
    async reassignStorageOwnership(): Promise<StorageReassignment> {
      return { supported: false, reassignedCount: 0 };
    },
  });
  const g = gateway(
    operation({
      state: 'provider_failed',
      providerOutcome: 'storage_blocked',
      revision: 2,
      storageOwnedCount: 3,
      storageReassignedCount: null,
    }),
  );
  const result = await administerAccountDeletion(g.value, p.value, input());
  assert.equal(result.providerOutcome, 'storage_blocked');
  assert.equal(g.recorded[0]!.storageOwned, 3);
  assert.equal(g.recorded[0]!.storageReassigned, null);
});

test('a first attempt records only the counts it observed', async () => {
  const unavailable = provider({
    async preflight(): Promise<StoragePreflight> {
      throw new Error('storage unavailable');
    },
  });
  const unobserved = gateway(operation());
  await administerAccountDeletion(unobserved.value, unavailable.value, input());
  assert.equal(unobserved.recorded[0]!.storageOwned, null);
  assert.equal(unobserved.recorded[0]!.storageReassigned, null);

  const unsupported = provider({
    async preflight(): Promise<StoragePreflight> {
      return { supported: true, ownedCount: 3 };
    },
    async reassignStorageOwnership(): Promise<StorageReassignment> {
      return { supported: false, reassignedCount: 0 };
    },
  });
  const observed = gateway(operation());
  await administerAccountDeletion(observed.value, unsupported.value, input());
  assert.equal(observed.recorded[0]!.storageOwned, 3);
  assert.equal(observed.recorded[0]!.storageReassigned, 0);
});
