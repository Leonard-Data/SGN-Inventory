import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discardExpiredRegistration,
  discardRefusedCompletion,
  expiredPendingRegistration,
  pendingUploadMs,
  sweepReleasedBytes,
} from './upload-cleanup.ts';

const objectPath = 'property-a/file-1/content';

function store() {
  const removed: string[] = [];
  const logged: string[] = [];
  return {
    removed,
    logged,
    deps: {
      remove: async (path: string) => {
        removed.push(path);
      },
      log: (message: string) => {
        logged.push(message);
      },
    },
  };
}

// The registration row behind the injected calls, so the test can observe the real order:
// the slot is released first, and the row only becomes failed once the bytes are gone.
function registration() {
  const base = store();
  const events: string[] = [];
  let status: 'pending' | 'cleanup_pending' | 'failed' = 'pending';
  let removeFails = 0;
  return {
    ...base,
    events,
    status: () => status,
    failNextRemoval: (times = 1) => {
      removeFails = times;
    },
    deps: {
      remove: async (path: string) => {
        events.push('remove');
        if (removeFails > 0) {
          removeFails--;
          throw new Error('R2 unavailable');
        }
        base.removed.push(path);
      },
      log: (message: string) => {
        base.logged.push(message);
      },
      pendingOwnerPath: async () => (status === 'pending' ? objectPath : null),
      releaseSlot: async () => {
        events.push('release');
        if (status === 'pending') status = 'cleanup_pending';
      },
      confirmCleaned: async () => {
        events.push('confirm');
        if (status === 'cleanup_pending') status = 'failed';
      },
    },
  };
}

test('a refused completion releases its slot before discarding the bytes', async () => {
  const subject = registration();
  await discardRefusedCompletion(subject.deps);
  assert.deepEqual(subject.events, ['release', 'remove', 'confirm']);
  assert.deepEqual(subject.removed, [objectPath]);
  assert.equal(subject.status(), 'failed');
});

test('a refused completion of a ready or another employee row discards nothing', async () => {
  const subject = registration();
  subject.deps.pendingOwnerPath = async () => null;
  await discardRefusedCompletion(subject.deps);
  assert.deepEqual(subject.events, []);
  assert.equal(subject.status(), 'pending');
});

test('a failed removal leaves the row eligible for cleanup instead of failed', async () => {
  const subject = registration();
  subject.failNextRemoval();
  await discardRefusedCompletion(subject.deps);
  assert.equal(subject.status(), 'cleanup_pending');
  assert.deepEqual(subject.removed, []);
  assert.equal(subject.logged.length, 1);

  // A later sweep retries the same row and only then records it failed.
  const swept = await sweepReleasedBytes(
    subject.deps,
    objectPath,
    subject.deps.confirmCleaned,
  );
  assert.equal(swept, true);
  assert.deepEqual(subject.removed, [objectPath]);
  assert.equal(subject.status(), 'failed');
});

test('every sweep retries a released row until its bytes are gone', async () => {
  const subject = registration();
  subject.failNextRemoval(3);
  await subject.deps.releaseSlot();
  assert.equal(subject.status(), 'cleanup_pending');
  for (let attempt = 0; attempt < 3; attempt++)
    assert.equal(
      await sweepReleasedBytes(
        subject.deps,
        objectPath,
        subject.deps.confirmCleaned,
      ),
      false,
    );
  assert.equal(subject.status(), 'cleanup_pending');
  assert.equal(subject.logged.length, 3);

  assert.equal(
    await sweepReleasedBytes(
      subject.deps,
      objectPath,
      subject.deps.confirmCleaned,
    ),
    true,
  );
  assert.equal(subject.status(), 'failed');
});

test('a release that does not commit keeps the row pending and deletes nothing', async () => {
  const subject = registration();
  subject.deps.releaseSlot = async () => {
    throw new Error('database unavailable');
  };
  await discardRefusedCompletion(subject.deps);
  assert.deepEqual(subject.removed, []);
  assert.equal(subject.status(), 'pending');
  assert.equal(subject.logged.length, 1);
});

test('only a pending registration past the upload window expires', () => {
  const now = Date.parse('2026-10-18T04:00:00.000Z');
  const old = new Date(now - pendingUploadMs - 1000).toISOString();
  const fresh = new Date(now - pendingUploadMs + 1000).toISOString();
  assert.equal(
    expiredPendingRegistration(
      { upload_status: 'pending', created_at: old },
      now,
    ),
    true,
  );
  assert.equal(
    expiredPendingRegistration(
      { upload_status: 'pending', created_at: fresh },
      now,
    ),
    false,
  );
  assert.equal(
    expiredPendingRegistration(
      { upload_status: 'ready', created_at: old },
      now,
    ),
    false,
  );
});

test('an expired registration reports absent only once its bytes are gone', async () => {
  const subject = store();
  assert.equal(
    await discardExpiredRegistration(subject.deps, objectPath),
    'absent',
  );
  assert.deepEqual(subject.removed, [objectPath]);

  const unavailable = store();
  unavailable.deps.remove = async () => {
    throw new Error('R2 unavailable');
  };
  assert.equal(
    await discardExpiredRegistration(unavailable.deps, objectPath),
    'unknown',
  );
  assert.equal(unavailable.logged.length, 1);
});
