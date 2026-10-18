import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discardExpiredRegistration,
  discardRefusedCompletion,
  expiredPendingRegistration,
  operatorCleanupLimit,
  pendingUploadMs,
  runFileCleanup,
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
  const confirmed: string[] = [];
  let status: 'pending' | 'cleanup_pending' | 'failed' = 'pending';
  let removeFails = 0;
  return {
    ...base,
    events,
    failedMarks: () => confirmed,
    status: () => status,
    setStatus: (next: 'pending' | 'cleanup_pending' | 'failed') => {
      status = next;
    },
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
        if (status !== 'pending') return false;
        status = 'cleanup_pending';
        return true;
      },
      confirmCleaned: async () => {
        events.push('confirm');
        if (status !== 'cleanup_pending') return;
        status = 'failed';
        confirmed.push('failed');
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

test('a release that matches no pending row leaves the bytes alone', async () => {
  // The row became ready between the discard read and the release, so the release reports that
  // it moved nothing and its now-readable object must survive.
  const subject = registration();
  let releaseReturns = false;
  subject.deps.releaseSlot = async () => {
    subject.events.push('release');
    if (releaseReturns) subject.setStatus('cleanup_pending');
    return releaseReturns;
  };
  await discardRefusedCompletion(subject.deps);
  assert.deepEqual(subject.events, ['release']);
  assert.deepEqual(subject.removed, []);
  assert.deepEqual(subject.failedMarks(), []);

  releaseReturns = true;
  await discardRefusedCompletion(subject.deps);
  assert.deepEqual(subject.removed, [objectPath]);
  assert.deepEqual(subject.failedMarks(), ['failed']);
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

// The pass is driven through the same two boundaries the server wires to the trusted client:
// what it is offered and what it writes back.
function pass(rows: { id: string; objectPath: string }[], backlog: number) {
  const removed: string[] = [];
  const marked: string[] = [];
  const logged: string[] = [];
  let failOn: string | null = null;
  const limits: number[] = [];
  return {
    removed,
    marked,
    logged,
    limits,
    failOnObject: (path: string) => {
      failOn = path;
    },
    source: {
      pending: async (limit: number) => {
        limits.push(limit);
        return rows.slice(0, limit);
      },
      remaining: async () => backlog,
    },
    writer: {
      remove: async (path: string) => {
        if (path === failOn) throw new Error('R2 unavailable');
        removed.push(path);
      },
      log: (message: string) => {
        logged.push(message);
      },
      markCleaned: async (fileId: string) => {
        marked.push(fileId);
      },
    },
  };
}

test('a cleanup pass deletes each object before recording it cleaned', async () => {
  const subject = pass(
    [
      { id: 'file-1', objectPath: 'property-a/file-1/content' },
      { id: 'file-2', objectPath: 'property-b/file-2/content' },
    ],
    2,
  );
  const summary = await runFileCleanup(
    subject.source,
    subject.writer,
    operatorCleanupLimit,
  );
  assert.deepEqual(subject.removed, [
    'property-a/file-1/content',
    'property-b/file-2/content',
  ]);
  assert.deepEqual(subject.marked, ['file-1', 'file-2']);
  assert.deepEqual(summary, { retried: 2, cleared: 2, remaining: 2 });
  assert.match(subject.logged.join('\n'), /retried 2, cleared 2, remaining 2/);
  assert.deepEqual(subject.limits, [operatorCleanupLimit]);
});

test('a failed deletion keeps the row for the next pass and does not stop it', async () => {
  const subject = pass(
    [
      { id: 'file-1', objectPath: 'property-a/file-1/content' },
      { id: 'file-2', objectPath: 'property-b/file-2/content' },
    ],
    2,
  );
  subject.failOnObject('property-a/file-1/content');
  const summary = await runFileCleanup(subject.source, subject.writer, 5);
  assert.deepEqual(subject.marked, ['file-2']);
  assert.deepEqual(summary, { retried: 2, cleared: 1, remaining: 2 });
});

test('a pass processes only the batch it was given', async () => {
  const subject = pass(
    [
      { id: 'file-1', objectPath: 'property-a/file-1/content' },
      { id: 'file-2', objectPath: 'property-b/file-2/content' },
      { id: 'file-3', objectPath: 'property-c/file-3/content' },
    ],
    3,
  );
  const summary = await runFileCleanup(subject.source, subject.writer, 2);
  assert.equal(summary.retried, 2);
  assert.deepEqual(subject.marked, ['file-1', 'file-2']);
  assert.equal(summary.remaining, 3);
});

test('an unreadable backlog or count never fails the request', async () => {
  const subject = pass([], 0);
  subject.source.pending = async () => {
    throw new Error('database unavailable');
  };
  subject.source.remaining = async () => {
    throw new Error('database unavailable');
  };
  const summary = await runFileCleanup(subject.source, subject.writer, 3);
  assert.deepEqual(summary, { retried: 0, cleared: 0, remaining: null });
  assert.equal(subject.logged.length, 2);
});

test('a quiet run with nothing to do writes no summary line', async () => {
  const subject = pass([], 0);
  const summary = await runFileCleanup(subject.source, subject.writer, 3);
  assert.deepEqual(summary, { retried: 0, cleared: 0, remaining: 0 });
  assert.deepEqual(subject.logged, []);
});
