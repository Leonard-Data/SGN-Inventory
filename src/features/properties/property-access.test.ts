import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, type RouteContext } from '../../lib/supabase/route.ts';
import { requireReadableProperty } from './property-access.ts';

function context(result: { data: unknown; error: { code?: string } | null }) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => result,
  };
  return {
    client: {
      from(table: string) {
        assert.equal(table, 'properties');
        return query;
      },
    },
  } as unknown as RouteContext;
}

test('readable property access allows an empty child result', async () => {
  await requireReadableProperty(
    context({ data: { id: 'property-1' }, error: null }),
    'property-1',
  );
});

test('missing property access is a property-level denial', async () => {
  await assert.rejects(
    requireReadableProperty(context({ data: null, error: null }), 'property-1'),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 404 &&
      error.code === 'property-not-found',
  );
});

test('property access query failures preserve denial classification', async () => {
  await assert.rejects(
    requireReadableProperty(
      context({ data: null, error: { code: '42501' } }),
      'property-1',
    ),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 403 &&
      error.code === 'access-denied',
  );
  await assert.rejects(
    requireReadableProperty(
      context({ data: null, error: { code: 'unexpected' } }),
      'property-1',
    ),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 503 &&
      error.code === 'unavailable',
  );
});
