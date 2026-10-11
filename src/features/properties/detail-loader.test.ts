import assert from 'node:assert/strict';
import test from 'node:test';
import { loadDetailSnapshot } from './detail-loader.ts';
import { RequestError } from '../employees/api.ts';

const id = '11111111-1111-4111-8111-111111111111';
const key = '22222222-2222-4222-8222-222222222222';
const detail = {
  property: {
    id,
    property_code: 'SGN-TEST-DETAIL',
    listing_mode: 'sale',
    property_type: 'house',
    access_type: null,
    status: 'available',
    record_review_status: 'unverified',
    legal_status: 'unknown',
    sale_price_vnd: '9007199254740993',
    monthly_rent_vnd: null,
    land_area_m2: null,
    frontage_m: null,
    depth_m: null,
    floor_area_m2: null,
    floors: null,
    bedrooms: null,
    bathrooms: null,
    direction: null,
    updated_at: '2026-10-10T16:00:00Z',
    archived_at: null,
    cover_file_id: null,
    created_by: null,
  },
  addresses: [],
  contacts: [],
};
const today = {
  businessDay: '2026-10-10',
  pageViewEvents: 3,
  distinctPropertiesViewed: 2,
};

test('revalidation refreshes the Vietnam day without adding another logical open', async (t) => {
  let businessDay = '2026-10-10';
  const recorded = new Set<string>();
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    assert.ok(options?.signal);
    if (path === `/api/properties/${id}`) return Response.json(detail);
    if (path === `/api/properties/${id}/page-view`) {
      const body = JSON.parse(String(options.body));
      assert.equal(body.key, key);
      recorded.add(body.key);
      return new Response(null, { status: 204 });
    }
    assert.equal(path, '/api/activity/today');
    return Response.json({
      businessDay,
      pageViewEvents: businessDay === '2026-10-10' ? recorded.size : 0,
      distinctPropertiesViewed: businessDay === '2026-10-10' ? 1 : 0,
    });
  });
  const first = await loadDetailSnapshot(id, key, new AbortController().signal);
  assert.deepEqual(first.today, {
    businessDay: '2026-10-10',
    pageViewEvents: 1,
    distinctPropertiesViewed: 1,
  });
  businessDay = '2026-10-11';
  const next = await loadDetailSnapshot(id, key, new AbortController().signal);
  assert.deepEqual(next.today, {
    businessDay: '2026-10-11',
    pageViewEvents: 0,
    distinctPropertiesViewed: 0,
  });
  assert.equal(recorded.size, 1);
  assert.deepEqual(next.property, detail.property);
});

test('an invalidated employee report cannot replace the new employee snapshot', async (t) => {
  const pending = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  let reports = 0;
  t.mock.method(globalThis, 'fetch', async (path) => {
    if (path === `/api/properties/${id}`) return Response.json(detail);
    if (path === `/api/properties/${id}/page-view`)
      return new Response(null, { status: 204 });
    assert.equal(path, '/api/activity/today');
    if (++reports === 1) {
      started.resolve();
      return pending.promise;
    }
    return Response.json({ ...today, pageViewEvents: 1 });
  });
  const oldScope = new AbortController();
  const old = loadDetailSnapshot(id, key, oldScope.signal);
  await started.promise;
  oldScope.abort();
  const next = await loadDetailSnapshot(id, key, new AbortController().signal);
  assert.equal(next.today?.pageViewEvents, 1);
  const rejected = assert.rejects(old, { name: 'AbortError' });
  pending.resolve(Response.json(today));
  await rejected;
  assert.equal(next.today?.pageViewEvents, 1);
});

test('activity denial rejects the entire protected snapshot', async (t) => {
  for (const deniedPath of [
    `/api/properties/${id}/page-view`,
    '/api/activity/today',
  ]) {
    for (const status of [401, 403]) {
      const fetch = t.mock.method(globalThis, 'fetch', async (path) => {
        if (path === deniedPath)
          return Response.json({ error: 'access-denied' }, { status });
        if (path === `/api/properties/${id}`) return Response.json(detail);
        return new Response(null, { status: 204 });
      });
      await assert.rejects(
        loadDetailSnapshot(id, key, new AbortController().signal),
        (failure: unknown) =>
          failure instanceof RequestError && failure.status === status,
      );
      fetch.mock.restore();
    }
  }
});

test('ordinary activity failure preserves detail and exposes retry state', async (t) => {
  t.mock.method(globalThis, 'fetch', async (path) => {
    if (path === `/api/properties/${id}`) return Response.json(detail);
    return Response.json({ error: 'unavailable' }, { status: 503 });
  });
  const result = await loadDetailSnapshot(
    id,
    key,
    new AbortController().signal,
  );
  assert.deepEqual(result.property, detail.property);
  assert.equal(result.viewError, true);
  assert.equal(result.todayError, true);
  assert.equal(result.today, null);
});
