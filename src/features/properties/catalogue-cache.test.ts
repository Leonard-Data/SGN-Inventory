import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  AccessChangedError,
  loadProtected,
  renderedSession,
} from '../employees/protected-load.ts';
import { RequestError } from '../employees/api.ts';
import type { EmployeeSession } from '../employees/types.ts';
import {
  catalogueCountQuery,
  readCatalogue,
  readCatalogueReplacement,
} from './catalogue-cache.ts';
import {
  acceptReplacementPage,
  beginRefresh,
  commitReplacement,
  NO_GENERATIONS,
} from './catalogue-refresh.ts';
import { indexCataloguePage, startCatalogueLoad } from './catalogue-load.ts';
import type { CataloguePage, PropertySummary } from './types.ts';

const reviewer: EmployeeSession = {
  employee: {
    id: 'reviewer',
    displayName: 'Reviewer',
    role: 'manager',
    locale: 'vi',
  },
  accessRevision: 1,
};
const sales: EmployeeSession = {
  employee: { id: 'sales', displayName: 'Sales', role: 'sales', locale: 'vi' },
  accessRevision: 2,
};
const record: PropertySummary = {
  id: 'retired-property',
  propertyCode: 'BDS-001',
  listingMode: 'sale',
  status: 'available',
  propertyType: 'house',
  salePriceVnd: '12000000000',
  monthlyRentVnd: null,
  createdAt: null,
  updatedAt: null,
  addresses: [
    {
      id: 'old-address',
      format: 'legacy',
      addressText: '12 Lê Lợi',
      mappingStatus: 'unresolved',
      isPrimary: true,
      houseNumber: '12',
      street: 'Lê Lợi',
      commune: null,
      district: 'Quận 1',
    },
  ],
  coverFileId: null,
  frontageM: null,
  depthM: null,
  landAreaM2: null,
  floorAreaM2: null,
  floors: null,
  direction: null,
  accessType: null,
  createdBy: null,
};
const privatePage: CataloguePage = { properties: [record], nextCursor: null };
const publicPage: CataloguePage = { properties: [], nextCursor: null };
const AT = '2026-10-20T00:00:00.000Z';
// The state one finished traversal reaches, with the one indexed page it read.
const privateLoad = indexCataloguePage(
  startCatalogueLoad('generation-1'),
  privatePage,
  AT,
);
const publicLoad = indexCataloguePage(
  startCatalogueLoad('generation-1'),
  publicPage,
  AT,
);
const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });
const flush = () => new Promise((resolve) => setImmediate(resolve));

function load(client: QueryClient, signal = new AbortController().signal) {
  return loadProtected({
    source: (signal, scope) =>
      readCatalogue(client, signal, scope, {
        publish: () => {},
        generationId: 'generation-1',
        now: () => AT,
      }),
    signal,
    renderedFor: null,
    renderedAccessRevision: null,
    onIdentityChange: () => {},
  });
}

test('a stable protected scope reuses the catalogue across route reads', async (t) => {
  const cache = client();
  t.after(() => cache.clear());
  let catalogueReads = 0;
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    if (path === '/api/session') return Response.json(reviewer);
    assert.equal(path, '/api/properties/catalogue');
    catalogueReads++;
    return Response.json(privatePage);
  });
  const first = await load(cache);
  const returned = await load(cache);
  assert.deepEqual(first.data, { scope: reviewer, load: privateLoad });
  assert.deepEqual(returned.data, first.data);
  assert.equal(catalogueReads, 1);
});

test('changing employee, role or revision discards the former catalogue', async (t) => {
  for (const next of [
    sales,
    { ...reviewer, employee: { ...reviewer.employee, role: 'sales' as const } },
    { ...reviewer, accessRevision: 2 },
  ]) {
    const cache = client();
    t.after(() => cache.clear());
    let current = reviewer;
    let catalogueReads = 0;
    t.mock.method(globalThis, 'fetch', async (path: string) => {
      if (path === '/api/session') return Response.json(current);
      assert.equal(path, '/api/properties/catalogue');
      catalogueReads++;
      return Response.json(current === reviewer ? privatePage : publicPage);
    });
    await load(cache);
    current = next;
    const returned = await load(cache);
    assert.deepEqual(returned.data, { scope: next, load: publicLoad });
    assert.equal(catalogueReads, 2);
    assert.deepEqual(
      cache
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
      [publicLoad],
    );
  }
});

test('authority changing during a catalogue read never publishes the earlier response', async (t) => {
  const cache = client();
  t.after(() => cache.clear());
  const arriving = Promise.withResolvers<Response>();
  let current = reviewer;
  let catalogueReads = 0;
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    if (path === '/api/session') return Response.json(current);
    assert.equal(path, '/api/properties/catalogue');
    return ++catalogueReads === 1
      ? arriving.promise
      : Response.json(publicPage);
  });
  const pending = load(cache);
  await flush();
  current = sales;
  arriving.resolve(Response.json(privatePage));
  const returned = await pending;
  assert.deepEqual(returned.data, { scope: sales, load: publicLoad });
  assert.equal(renderedSession(returned.employee), 'sales:sales');
  assert.deepEqual(
    cache
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data),
    [publicLoad],
  );
});

test('replacement promotion waits for the final authority check', async (t) => {
  const checked = Promise.withResolvers<Response>();
  let checks = 0;
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    if (path === '/api/session')
      return ++checks === 1 ? Response.json(reviewer) : checked.promise;
    assert.equal(path, '/api/properties/catalogue');
    return Response.json(publicPage);
  });
  let state = beginRefresh(
    { ...NO_GENERATIONS, working: privateLoad },
    'replacement',
  );
  const pending = readCatalogueReplacement(
    new AbortController().signal,
    reviewer,
    state.staged!,
    (page) => {
      state = acceptReplacementPage(state, 'replacement', page, AT);
    },
  ).then(() => {
    state = commitReplacement(state, 'replacement');
  });
  await flush();
  assert.equal(state.working, privateLoad);
  assert.equal(state.staged?.isComplete, true);
  checked.resolve(Response.json(reviewer));
  await pending;
  assert.deepEqual(state.working?.index, []);
  assert.equal(state.working?.generationId, 'replacement');
});

test('a replacement refuses changed identity, role or revision before promotion', async (t) => {
  for (const current of [
    sales,
    { ...reviewer, employee: { ...reviewer.employee, role: 'sales' as const } },
    { ...reviewer, accessRevision: 2 },
  ]) {
    let checks = 0;
    t.mock.method(globalThis, 'fetch', async (path: string) =>
      path === '/api/session'
        ? Response.json(++checks === 1 ? reviewer : current)
        : Response.json(publicPage),
    );
    let state = beginRefresh(
      { ...NO_GENERATIONS, working: privateLoad },
      'replacement',
    );
    await assert.rejects(
      readCatalogueReplacement(
        new AbortController().signal,
        reviewer,
        state.staged!,
        (page) => {
          state = acceptReplacementPage(state, 'replacement', page, AT);
        },
      ),
      AccessChangedError,
    );
    assert.equal(state.working, privateLoad);
  }
});

test('page and final-session denials end replacement loading', async (t) => {
  for (const status of [401, 403]) {
    for (const deniedAt of ['page', 'final-session']) {
      let checks = 0;
      const paths: string[] = [];
      t.mock.method(globalThis, 'fetch', async (path: string) => {
        paths.push(path);
        if (path === '/api/session' && ++checks === 1)
          return Response.json(reviewer);
        if ((path === '/api/session') === (deniedAt === 'final-session'))
          return Response.json(
            { error: status === 401 ? 'unauthenticated' : 'access-denied' },
            { status },
          );
        return Response.json(privatePage);
      });
      await assert.rejects(
        readCatalogueReplacement(
          new AbortController().signal,
          reviewer,
          startCatalogueLoad('replacement'),
          () => {},
        ),
        (error: unknown) =>
          error instanceof RequestError && error.status === status,
      );
      assert.equal(paths.length, deniedAt === 'page' ? 2 : 3);
    }
  }
});

test('a fully traversed retry rechecks authority without rereading rows', async (t) => {
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    paths.push(path);
    assert.equal(path, '/api/session');
    return Response.json(reviewer);
  });
  await readCatalogueReplacement(
    new AbortController().signal,
    reviewer,
    privateLoad,
    () => assert.fail('already indexed'),
  );
  assert.deepEqual(paths, ['/api/session', '/api/session']);
});

test('a generation keeps its authorized count during and after promotion', async (t) => {
  const cache = client();
  t.after(() => cache.clear());
  const arriving = Promise.withResolvers<Response>();
  let counts = 0;
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    if (path === '/api/session') return Response.json(reviewer);
    assert.equal(path, '/api/properties/catalogue/count');
    counts++;
    return counts === 1 ? arriving.promise : Response.json({ total: 3 });
  });
  const options = catalogueCountQuery(reviewer, 'replacement');
  const staged = new QueryObserver(cache, options);
  const stopStaged = staged.subscribe(() => {});
  const working = new QueryObserver(cache, options);
  const stopWorking = working.subscribe(() => {});
  t.after(stopWorking);
  stopStaged();
  arriving.resolve(Response.json({ total: 42 }));
  const count = await cache.fetchQuery(options);
  assert.equal(count.total, 42);
  assert.ok(count.capturedAt);
  assert.deepEqual(working.getCurrentResult().data, count);
  assert.deepEqual(await cache.fetchQuery(options), count);
  assert.equal(counts, 1);
  await cache.fetchQuery(catalogueCountQuery(reviewer, 'next-replacement'));
  assert.equal(counts, 2);
});

test('count outages stay unknown for their generation but denials propagate', async (t) => {
  for (const status of [503, 401, 403]) {
    const cache = client();
    t.after(() => cache.clear());
    let counts = 0;
    t.mock.method(globalThis, 'fetch', async (path: string) => {
      if (path === '/api/session') return Response.json(reviewer);
      counts++;
      return Response.json(
        { error: status === 503 ? 'unavailable' : 'access-denied' },
        { status },
      );
    });
    const options = catalogueCountQuery(reviewer, 'replacement');
    if (status === 503) {
      assert.deepEqual(await cache.fetchQuery(options), {
        total: null,
        capturedAt: null,
      });
      assert.deepEqual(await cache.fetchQuery(options), {
        total: null,
        capturedAt: null,
      });
      assert.equal(counts, 1);
    } else {
      await assert.rejects(
        cache.fetchQuery(options),
        (error: unknown) =>
          error instanceof RequestError && error.status === status,
      );
    }
  }
});

test('a count authorized on a changed scope is never captured', async (t) => {
  const cache = client();
  t.after(() => cache.clear());
  let checks = 0;
  t.mock.method(globalThis, 'fetch', async (path: string) =>
    path === '/api/session'
      ? Response.json(++checks === 1 ? reviewer : sales)
      : Response.json({ total: 42 }),
  );
  await assert.rejects(
    cache.fetchQuery(catalogueCountQuery(reviewer, 'replacement')),
    AccessChangedError,
  );
});

test('a replaced scope cancels its pending read and cannot repopulate the cache', async (t) => {
  const cache = client();
  t.after(() => cache.clear());
  const arriving = Promise.withResolvers<Response>();
  let current = reviewer;
  const originalSignals: AbortSignal[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (path: string, options?: RequestInit) => {
      if (path === '/api/session') return Response.json(current);
      assert.equal(path, '/api/properties/catalogue');
      if (current === reviewer) {
        if (options?.signal) originalSignals.push(options.signal);
        return arriving.promise;
      }
      return Response.json(publicPage);
    },
  );
  const pending = load(cache);
  const rejected = assert.rejects(pending);
  await flush();
  current = sales;
  const returned = await load(cache);
  arriving.resolve(Response.json(privatePage));
  await rejected;
  assert.equal(originalSignals[0]?.aborted, true);
  assert.deepEqual(returned.data, { scope: sales, load: publicLoad });
  assert.deepEqual(
    cache
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data),
    [publicLoad],
  );
});
