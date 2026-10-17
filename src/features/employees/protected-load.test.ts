import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadProtected,
  refocusAction,
  renderedSession,
  sessionDiffers,
} from './protected-load.ts';
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
const manager: Employee = {
  id: 'emp-manager',
  displayName: 'Manager',
  role: 'manager',
  locale: 'vi',
};
const archived = { property: { id: 'archived-1' } };

const flush = () => new Promise((resolve) => setImmediate(resolve));
const sessionResponse = (employee: Employee, accessRevision = 0) =>
  Response.json({ employee, accessRevision });

test('an unchanged access revision is the same session', () => {
  const current = { employee: manager, accessRevision: 2 };

  assert.equal(sessionDiffers(renderedSession(manager), 2, current), false);
  assert.equal(sessionDiffers(renderedSession(manager), 1, current), true);
  assert.equal(sessionDiffers(renderedSession(reviewer), 2, current), true);
});

test('same-identity reload keeps the rendered snapshot without concealing', async (t) => {
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    assert.equal(path, '/api/session');
    return sessionResponse(reviewer);
  });
  const events: string[] = [];
  const result = await loadProtected({
    source: async () => archived,
    signal: new AbortController().signal,
    renderedFor: renderedSession(reviewer),
    renderedAccessRevision: 0,
    onIdentityChange: () => {
      events.push('conceal');
    },
  });
  assert.deepEqual(events, []);
  assert.deepEqual(result, {
    employee: reviewer,
    data: archived,
    accessRevision: 0,
  });
});

test('an advanced access revision conceals the rendered snapshot before its data is published', async (t) => {
  const session = Promise.withResolvers<Response>();
  const source = Promise.withResolvers<typeof archived>();
  const events: string[] = [];
  let settled = false;
  let sessionReads = 0;
  t.mock.method(globalThis, 'fetch', async () =>
    sessionReads++ === 0 ? session.promise : sessionResponse(reviewer, 1),
  );
  const pending = loadProtected({
    source: () => {
      events.push('source-requested');
      return source.promise;
    },
    signal: new AbortController().signal,
    renderedFor: renderedSession(reviewer),
    renderedAccessRevision: 0,
    onIdentityChange: () => {
      events.push('conceal');
      assert.equal(settled, false);
    },
  }).finally(() => {
    settled = true;
  });
  await flush();
  session.resolve(sessionResponse(reviewer, 1));
  await flush();
  assert.deepEqual(events, ['source-requested', 'conceal']);
  assert.equal(settled, false);
  source.resolve(archived);
  assert.deepEqual(await pending, {
    employee: reviewer,
    data: archived,
    accessRevision: 1,
  });
});

test('an ordinary employee replacing a reviewer conceals the archived snapshot before its data is published', async (t) => {
  const session = Promise.withResolvers<Response>();
  const source = Promise.withResolvers<typeof archived>();
  const events: string[] = [];
  let settled = false;
  let sessionReads = 0;
  t.mock.method(globalThis, 'fetch', async () =>
    sessionReads++ === 0 ? session.promise : sessionResponse(sales),
  );
  const pending = loadProtected({
    source: () => {
      events.push('source-requested');
      return source.promise;
    },
    signal: new AbortController().signal,
    renderedFor: renderedSession(reviewer),
    renderedAccessRevision: 0,
    onIdentityChange: () => {
      events.push('conceal');
      assert.equal(settled, false);
    },
  }).finally(() => {
    settled = true;
  });
  await flush();
  session.resolve(sessionResponse(sales));
  await flush();
  assert.deepEqual(events, ['source-requested', 'conceal']);
  assert.equal(settled, false);
  source.resolve(archived);
  assert.deepEqual(await pending, {
    employee: sales,
    data: archived,
    accessRevision: 0,
  });
});

test('the same employee with a different role conceals the manager snapshot before its data is published', async (t) => {
  const session = Promise.withResolvers<Response>();
  const source = Promise.withResolvers<typeof archived>();
  const events: string[] = [];
  let sessionReads = 0;
  t.mock.method(globalThis, 'fetch', async () =>
    sessionReads++ === 0
      ? session.promise
      : sessionResponse({ ...manager, role: 'sales' }),
  );
  const pending = loadProtected({
    source: () => {
      events.push('source-requested');
      return source.promise;
    },
    signal: new AbortController().signal,
    renderedFor: renderedSession(manager),
    renderedAccessRevision: 0,
    onIdentityChange: () => {
      events.push('conceal');
    },
  });
  await flush();
  session.resolve(sessionResponse({ ...manager, role: 'sales' }));
  await flush();
  assert.deepEqual(events, ['source-requested', 'conceal']);
  source.resolve(archived);
  assert.deepEqual(await pending, {
    employee: { ...manager, role: 'sales' },
    data: archived,
    accessRevision: 0,
  });
});

test('no rendered identity yet still conceals before publishing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => sessionResponse(sales));
  const events: string[] = [];
  const result = await loadProtected({
    source: async () => archived,
    signal: new AbortController().signal,
    renderedFor: null,
    renderedAccessRevision: null,
    onIdentityChange: () => {
      events.push('conceal');
    },
  });
  assert.deepEqual(events, ['conceal']);
  assert.deepEqual(result, {
    employee: sales,
    data: archived,
    accessRevision: 0,
  });
});

test('a revision advancing during the read discards the data it was read under', async (t) => {
  let sessionReads = 0;
  let sourceReads = 0;
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    assert.equal(path, '/api/session');
    // The first session read and the recheck after the data both belong to the
    // superseded revision; the restarted read sees the advanced one.
    return sessionResponse(sales, sessionReads++ === 0 ? 1 : 3);
  });
  const result = await loadProtected({
    source: async () => {
      sourceReads++;
      return { property: { id: `read-${sourceReads}` } };
    },
    signal: new AbortController().signal,
    renderedFor: renderedSession(sales),
    renderedAccessRevision: 1,
    onIdentityChange: () => {},
  });
  assert.equal(sourceReads, 2);
  assert.deepEqual(result, {
    employee: sales,
    data: { property: { id: 'read-2' } },
    accessRevision: 3,
  });
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
      renderedFor: renderedSession(reviewer),
      renderedAccessRevision: 0,
      onIdentityChange: () => {
        concealed += 1;
      },
    }),
    (failure: unknown) =>
      failure instanceof RequestError && failure.status === 403,
  );
  assert.equal(concealed, 0);
});

test('a read in flight owns the surface, a displayed session is rechecked and a cleared one is read again', () => {
  assert.equal(refocusAction(null, true), 'none');
  assert.equal(refocusAction(renderedSession(reviewer), false), 'recheck');
  assert.equal(refocusAction(null, false), 'reload');
});
