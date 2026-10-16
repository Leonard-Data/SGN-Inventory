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

test('rendered session comparison includes the access revision', () => {
  const current = { employee: manager, accessRevision: 2 };

  assert.equal(
    sessionDiffers(renderedSession(manager), 1, current),
    true,
  );
  assert.equal(
    sessionDiffers(renderedSession(manager), 2, current),
    false,
  );
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
  assert.deepEqual(events, []);
  session.resolve(sessionResponse(sales));
  await flush();
  assert.deepEqual(events, ['conceal', 'source-requested']);
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
  assert.deepEqual(events, []);
  session.resolve(sessionResponse({ ...manager, role: 'sales' }));
  await flush();
  assert.deepEqual(events, ['conceal', 'source-requested']);
  source.resolve(archived);
  assert.deepEqual(await pending, {
    employee: { ...manager, role: 'sales' },
    data: archived,
    accessRevision: 0,
  });
});

test('a first load does not report an identity change before publishing', async (t) => {
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
  assert.deepEqual(events, []);
  assert.deepEqual(result, {
    employee: sales,
    data: archived,
    accessRevision: 0,
  });
});

test('a source result is discarded when access changes away and back during the read', async (t) => {
  const firstSource = Promise.withResolvers<typeof archived>();
  const secondSource = Promise.withResolvers<typeof archived>();
  let sessionReads = 0;
  let sourceReads = 0;
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    assert.equal(path, '/api/session');
    sessionReads++;
    return sessionResponse(sales, sessionReads === 1 ? 1 : 3);
  });
  const pending = loadProtected({
    source: () => {
      sourceReads++;
      return (sourceReads === 1 ? firstSource : secondSource).promise;
    },
    signal: new AbortController().signal,
    renderedFor: null,
    renderedAccessRevision: null,
    onIdentityChange: () => {
      assert.fail('first loads do not conceal an empty surface');
    },
  });
  await flush();
  assert.equal(sourceReads, 1);
  firstSource.resolve(archived);
  await flush();
  assert.equal(sessionReads, 2);
  assert.equal(sourceReads, 2);
  const fresh = { property: { id: 'fresh-aba' } };
  secondSource.resolve(fresh);
  assert.deepEqual(await pending, {
    employee: sales,
    data: fresh,
    accessRevision: 3,
  });
});

test('a first read discards data when identity changes during the source read', async (t) => {
  const firstSession = Promise.withResolvers<Response>();
  const secondSession = Promise.withResolvers<Response>();
  const firstSource = Promise.withResolvers<typeof archived>();
  const secondSource = Promise.withResolvers<typeof archived>();
  let sessionReads = 0;
  let sourceReads = 0;
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    assert.equal(path, '/api/session');
    const read = sessionReads++;
    return read === 0
      ? firstSession.promise
      : read === 1
        ? secondSession.promise
        : sessionResponse(sales, 2);
  });
  const pending = loadProtected({
    source: () => {
      sourceReads++;
      return (sourceReads === 1 ? firstSource : secondSource).promise;
    },
    signal: new AbortController().signal,
    renderedFor: null,
    renderedAccessRevision: null,
    onIdentityChange: () => {
      assert.fail('first loads do not conceal an empty surface');
    },
  });
  await flush();
  firstSession.resolve(sessionResponse(manager, 1));
  await flush();
  assert.equal(sourceReads, 1);
  firstSource.resolve(archived);
  await flush();
  assert.equal(sessionReads, 2);
  secondSession.resolve(sessionResponse(sales, 2));
  await flush();
  assert.equal(sourceReads, 2);
  const fresh = { property: { id: 'fresh-1' } };
  secondSource.resolve(fresh);
  assert.deepEqual(await pending, {
    employee: sales,
    data: fresh,
    accessRevision: 2,
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
