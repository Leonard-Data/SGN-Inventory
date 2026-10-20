import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { loadProtected, renderedSession } from '../employees/protected-load.ts';
import type { EmployeeSession } from '../employees/types.ts';
import { readCatalogue } from './catalogue-cache.ts';
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
