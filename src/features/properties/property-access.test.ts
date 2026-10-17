import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPropertyRead } from './property-access-core.ts';

test('a present property row is readable, allowing an empty child result', () => {
  assert.equal(
    classifyPropertyRead({ data: { id: 'property-1' }, error: null }),
    null,
  );
});

test('missing property access is a property-level denial', () => {
  assert.deepEqual(classifyPropertyRead({ data: null, error: null }), {
    status: 404,
    code: 'property-not-found',
  });
});

test('property access query failures preserve denial classification', () => {
  assert.deepEqual(
    classifyPropertyRead({ data: null, error: { code: '42501' } }),
    { status: 403, code: 'access-denied' },
  );
  assert.deepEqual(
    classifyPropertyRead({ data: null, error: { code: 'unexpected' } }),
    { status: 503, code: 'unavailable' },
  );
});
