import assert from 'node:assert/strict';
import test from 'node:test';
import { toComment, toWireComment, type Comment } from './types.ts';

const wire: Comment = {
  id: '11111111-1111-4111-8111-111111111111',
  propertyId: '22222222-2222-4222-8222-222222222222',
  authorId: '33333333-3333-4333-8333-333333333333',
  authorName: 'Fixture',
  body: 'Nội dung hiện tại',
  createdAt: '2026-10-12T00:00:00Z',
  revision: '44444444-4444-4444-8444-444444444444',
  editedAt: '2026-10-12T01:00:00Z',
};

test('a serialized conflict comment validates as the application wire shape', () => {
  assert.deepEqual(toWireComment(wire), wire);
});

test('the wire shape is not a database row', () => {
  assert.equal(toComment(wire), null);
});

test('an untrusted conflict payload maps to null', () => {
  assert.equal(toWireComment({ body: 'no identity' }), null);
  assert.equal(toWireComment(null), null);
});
