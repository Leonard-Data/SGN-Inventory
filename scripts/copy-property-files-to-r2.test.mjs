import assert from 'node:assert/strict';
import test from 'node:test';
import { planCopy } from './copy-property-files-to-r2.mjs';

const row = (objectPath, sizeBytes) => ({
  object_path: objectPath,
  size_bytes: sizeBytes,
  sha256: 'a'.repeat(64),
  mime_type: 'application/pdf',
});

test('the copy plan is idempotent and reports what it would copy', () => {
  const rows = [
    row('property-a/file-1/content', 1024),
    row('property-a/file-2/content', 2048),
  ];
  const first = planCopy(rows, new Map());
  assert.deepEqual(
    first.copies.map((entry) => entry.object_path),
    ['property-a/file-1/content', 'property-a/file-2/content'],
  );
  assert.deepEqual(first.kept, []);
  assert.deepEqual(first.conflicts, []);

  const rerun = planCopy(
    rows,
    new Map([
      ['property-a/file-1/content', 1024],
      ['property-a/file-2/content', 2048],
    ]),
  );
  assert.deepEqual(rerun.copies, []);
  assert.equal(rerun.kept.length, 2);
});

test('an object of a different size is a conflict, never an overwrite', () => {
  const rows = [row('property-a/file-1/content', 1024)];
  const plan = planCopy(rows, new Map([['property-a/file-1/content', 999]]));
  assert.deepEqual(plan.copies, []);
  assert.deepEqual(plan.kept, []);
  assert.deepEqual(plan.conflicts, [{ ...rows[0], storedSize: 999 }]);
});

test('the verification pass compares key sets, not only sizes', () => {
  const rows = [row('property-a/file-1/content', 1024)];
  const plan = planCopy(
    rows,
    new Map([
      ['property-a/file-1/content', 1024],
      ['property-a/orphan/content', 10],
    ]),
  );
  assert.deepEqual(plan.unregistered, ['property-a/orphan/content']);
  assert.equal(plan.kept.length, 1);
});

test('a legacy row with no recorded size is copied, and never blocks the run', () => {
  const rows = [row('property-a/file-1/content', null)];
  const missing = planCopy(rows, new Map());
  assert.deepEqual(
    missing.copies.map((entry) => entry.object_path),
    ['property-a/file-1/content'],
  );
  assert.deepEqual(missing.conflicts, []);

  const present = planCopy(
    rows,
    new Map([['property-a/file-1/content', 4096]]),
  );
  assert.deepEqual(present.copies, []);
  assert.deepEqual(present.conflicts, []);
  assert.equal(present.kept.length, 1);
});
