import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discardExpiredRegistration,
  discardRefusedCompletion,
  expiredPendingRegistration,
  pendingUploadMs,
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

function refused(
  patch: { pendingOwnerPath?: () => Promise<string | null> } = {},
) {
  const base = store();
  const failed: string[] = [];
  return {
    ...base,
    failed,
    deps: {
      ...base.deps,
      pendingOwnerPath: patch.pendingOwnerPath ?? (async () => objectPath),
      fail: async () => {
        failed.push('failed');
      },
    },
  };
}

test('a refused completion discards the bytes and then marks the row failed', async () => {
  const subject = refused();
  await discardRefusedCompletion(subject.deps);
  assert.deepEqual(subject.removed, [objectPath]);
  assert.deepEqual(subject.failed, ['failed']);
});

test('a refused completion of a ready or another employee row discards nothing', async () => {
  const subject = refused({ pendingOwnerPath: async () => null });
  await discardRefusedCompletion(subject.deps);
  assert.deepEqual(subject.removed, []);
  assert.deepEqual(subject.failed, []);
});

test('a failed removal still marks the row failed and is logged server-side', async () => {
  const subject = refused();
  subject.deps.remove = async () => {
    throw new Error('R2 unavailable');
  };
  await discardRefusedCompletion(subject.deps);
  assert.deepEqual(subject.failed, ['failed']);
  assert.equal(subject.logged.length, 1);
  assert.match(subject.logged[0]!, /property-a\/file-1\/content/);
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
