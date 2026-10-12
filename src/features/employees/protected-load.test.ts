import assert from 'node:assert/strict';
import test from 'node:test';
import { loadProtected } from './protected-load.ts';
import { RequestError } from './api.ts';
import type { Employee } from './types.ts';

const reviewer: Employee = {
  id: 'emp-reviewer',
  displayName: 'Reviewer',
  role: 'staff',
  locale: 'vi',
};
const sales: Employee = {
  id: 'emp-sales',
  displayName: 'Sales',
  role: 'sales',
  locale: 'vi',
};
const archived = { property: { id: 'archived-1' } };

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('same-identity reload keeps the rendered snapshot without concealing', async (t) => {
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    assert.equal(path, '/api/session');
    return Response.json({ employee: reviewer });
  });
  const events: string[] = [];
  const result = await loadProtected({
    source: async () => archived,
    signal: new AbortController().signal,
    renderedFor: reviewer.id,
    onIdentityChange: () => {
      events.push('conceal');
    },
  });
  assert.deepEqual(events, []);
  assert.deepEqual(result, { employee: reviewer, data: archived });
});

test('an ordinary employee replacing a reviewer conceals the archived snapshot before its data is published', async (t) => {
  const session = Promise.withResolvers<Response>();
  const source = Promise.withResolvers<typeof archived>();
  const events: string[] = [];
  let settled = false;
  t.mock.method(globalThis, 'fetch', async () => session.promise);
  const pending = loadProtected({
    source: () => {
      events.push('source-requested');
      return source.promise;
    },
    signal: new AbortController().signal,
    renderedFor: reviewer.id,
    onIdentityChange: () => {
      events.push('conceal');
      assert.equal(settled, false);
    },
  }).finally(() => {
    settled = true;
  });
  await flush();
  session.resolve(Response.json({ employee: sales }));
  await flush();
  assert.deepEqual(events, ['source-requested', 'conceal']);
  assert.equal(settled, false);
  source.resolve(archived);
  assert.deepEqual(await pending, { employee: sales, data: archived });
});

test('no rendered identity yet still conceals before publishing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ employee: sales }),
  );
  const events: string[] = [];
  const result = await loadProtected({
    source: async () => archived,
    signal: new AbortController().signal,
    renderedFor: null,
    onIdentityChange: () => {
      events.push('conceal');
    },
  });
  assert.deepEqual(events, ['conceal']);
  assert.deepEqual(result, { employee: sales, data: archived });
});

test('a denied session rejects without publishing or concealing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: 'access-denied' }, { status: 403 }),
  );
  let concealed = 0;
  await assert.rejects(
    loadProtected({
      source: async () => archived,
      signal: new AbortController().signal,
      renderedFor: reviewer.id,
      onIdentityChange: () => {
        concealed += 1;
      },
    }),
    (failure: unknown) =>
      failure instanceof RequestError && failure.status === 403,
  );
  assert.equal(concealed, 0);
});
