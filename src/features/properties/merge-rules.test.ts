import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeRequest, movedObjectPath } from './merge-rules.ts';

const keep = '11111111-1111-4111-8111-111111111111';
const folded = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';

test('a merge request names one surviving record and one or more folded records', () => {
  assert.deepEqual(mergeRequest(keep, { merge: [folded] }), {
    keepId: keep,
    merge: [folded],
  });
  assert.deepEqual(mergeRequest(keep, { merge: [folded, other] }), {
    keepId: keep,
    merge: [folded, other],
  });
});

test('a malformed merge request is refused before anything moves', () => {
  assert.equal(mergeRequest('not-a-uuid', { merge: [folded] }), null);
  assert.equal(mergeRequest(keep, {}), null);
  assert.equal(mergeRequest(keep, { merge: [] }), null);
  assert.equal(mergeRequest(keep, { merge: 'all' }), null);
  assert.equal(mergeRequest(keep, { merge: [folded, folded] }), null);
  assert.equal(mergeRequest(keep, { merge: [keep] }), null);
  assert.equal(mergeRequest(keep, { merge: [folded, 'x'] }), null);
  assert.equal(mergeRequest(keep, { merge: [null] }), null);
  assert.equal(mergeRequest(keep, { merge: [folded], keepId: keep }), null);
  assert.equal(
    mergeRequest(keep, {
      merge: Array.from({ length: 21 }, () => crypto.randomUUID()),
    }),
    null,
  );
});

test('a moved file lands on the surviving property key with its own tail', () => {
  const file = {
    id: '44444444-4444-4444-8444-444444444444',
    propertyId: folded,
    objectPath: `${folded}/44444444-4444-4444-8444-444444444444/content`,
  };
  assert.equal(
    movedObjectPath(keep, file),
    `${keep}/44444444-4444-4444-8444-444444444444/content`,
  );
  assert.equal(
    movedObjectPath(keep, {
      id: '44444444-4444-4444-8444-444444444444',
      propertyId: keep,
      objectPath: `${keep}/44444444-4444-4444-8444-444444444444/giấy tờ.pdf`,
    }),
    `${keep}/44444444-4444-4444-8444-444444444444/giấy tờ.pdf`,
  );
});

test('a file record whose key is not bound to it stops the merge', () => {
  const id = '44444444-4444-4444-8444-444444444444';
  assert.equal(
    movedObjectPath(keep, {
      id,
      propertyId: folded,
      objectPath: `${other}/${id}/content`,
    }),
    null,
  );
  assert.equal(
    movedObjectPath(keep, { id, propertyId: folded, objectPath: '' }),
    null,
  );
});
