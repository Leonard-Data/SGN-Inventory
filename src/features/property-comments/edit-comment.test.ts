import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { RouteContext } from '@/lib/supabase/route';

// The feature resolves `@/` and `server-only` through Next's bundler; node:test needs the
// same aliases, so the mapping is registered before the modules are imported.
register('../../../scripts/ts-alias-hooks.mjs', import.meta.url);
const { editComment } = await import('./data.ts');
const { NextRequest } = await import('next/server');
const route =
  await import('../../../src/app/api/properties/[id]/comments/[commentId]/route.ts');

// The route reads its configuration from the environment it runs in.
Object.assign(process.env, {
  SGN_ENV: 'dev',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
});
delete process.env.EXPECTED_SUPABASE_PROJECT_REF;

const property = '20000000-0000-4000-8000-000000000001';
const otherProperty = '20000000-0000-4000-8000-000000000002';
const commentId = '40000000-0000-4000-8000-000000000001';
const originalRevision = '50000000-0000-4000-8000-000000000001';
const currentRevision = '50000000-0000-4000-8000-000000000002';
const employeeId = '10000000-0000-4000-8000-000000000001';
const authUserId = '10000000-0000-4000-8000-0000000000a1';
const currentRow = {
  id: commentId,
  property_id: property,
  author_id: employeeId,
  author_name: 'Fixture Author',
  body: 'Nội dung đã lưu',
  created_at: '2026-10-12T03:00:00Z',
  revision: currentRevision,
  edited_at: '2026-10-12T04:00:00Z',
};
const currentComment = {
  id: commentId,
  propertyId: property,
  authorId: employeeId,
  authorName: 'Fixture Author',
  body: 'Nội dung đã lưu',
  createdAt: currentRow.created_at,
  revision: currentRevision,
  editedAt: '2026-10-12T04:00:00Z',
};
const draft = { body: '  Nội dung đã sửa  ', revision: originalRevision };

type Call = {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// The real Supabase client against a stubbed Auth/Data API answering the paths, rows and
// error codes a real deployment does, so the whole edit read/write contract is exercised.
function stubApi(options: {
  rows?: Array<Record<string, unknown>>;
  rpc?: (call: Call) => Response;
  conflictRows?: Array<Record<string, unknown>>;
}) {
  const calls: Call[] = [];
  const fake = async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    if (url.includes('/auth/v1/user'))
      return json({ id: authUserId, email: 'fixture@example.test' });
    if (url.includes('/rest/v1/employees'))
      return json([
        {
          id: employeeId,
          display_name: 'Fixture Author',
          role: 'sales',
          preferred_locale: 'vi',
        },
      ]);
    if (url.includes('/rpc/edit_property_comment'))
      return options.rpc?.(call) ?? json(currentRow);
    // The conflict re-read is scoped by the path Property; the scope probe is not.
    if (url.includes('property_id=eq.' + property))
      return json(options.conflictRows ?? []);
    return json(options.rows ?? []);
  };
  return { calls, fake: fake as typeof globalThis.fetch };
}

function context(fetcher: typeof globalThis.fetch): RouteContext {
  return {
    client: createServerClient<Database>(
      'http://127.0.0.1:54321',
      'sb_publishable_fixture',
      {
        cookies: { getAll: () => [], setAll: () => {} },
        global: { fetch: fetcher },
      },
    ) as SupabaseClient<Database>,
    environment: {
      stage: 'dev',
      supabaseUrl: 'http://127.0.0.1:54321',
      publishableKey: 'sb_publishable_fixture',
      appUrl: 'http://localhost:3000',
    },
    finish: (response) => response,
    setLocale: () => {},
    setSessionPersistence: () => {},
  };
}

async function refused(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return error as { status?: number; code?: string; payload?: unknown };
  }
  throw new Error('expected the edit to be refused');
}

function sessionCookie() {
  const session = Buffer.from(
    JSON.stringify({
      access_token: 'fixture-access-token',
      refresh_token: 'fixture-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: authUserId },
    }),
  ).toString('base64url');
  return `sb-127-auth-token=base64-${session}`;
}

async function routePost(path: string) {
  const request = new NextRequest(
    `http://localhost:3000/api/properties/${path}/comments/${commentId}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        cookie: sessionCookie(),
      },
      body: JSON.stringify(draft),
    },
  );
  return route.POST(request, {
    params: Promise.resolve({ id: path, commentId }),
  });
}

test('an edit through another Property path is refused before the write', async () => {
  const api = stubApi({ rows: [{ property_id: property }] });
  const error = await refused(() =>
    editComment(context(api.fake), otherProperty, commentId, draft),
  );
  assert.equal(error.status, 404);
  assert.equal(error.code, 'not-found');
  assert.equal(
    api.calls.some((call) => call.url.includes('/rpc/edit_property_comment')),
    false,
    'the mismatched path must not attempt the write',
  );
});

test('the matched path saves the trimmed text and returns the edited current comment', async () => {
  const api = stubApi({ rows: [{ property_id: property }] });
  const edited = await editComment(
    context(api.fake),
    property,
    commentId,
    draft,
  );
  assert.deepEqual(edited, currentComment);
  const write = api.calls.find((call) =>
    call.url.includes('/rpc/edit_property_comment'),
  );
  assert.deepEqual(write?.body, {
    p_comment_id: commentId,
    p_body: 'Nội dung đã sửa',
    p_expected_revision: originalRevision,
  });
});

test('a stale save is a conflict carrying the current saved text for reconciliation', async () => {
  const api = stubApi({
    rows: [{ property_id: property }],
    rpc: () =>
      json(
        { code: 'PT409', message: 'stale revision', details: null, hint: null },
        409,
      ),
    conflictRows: [currentRow],
  });
  const error = await refused(() =>
    editComment(context(api.fake), property, commentId, draft),
  );
  assert.equal(error.status, 409);
  assert.equal(error.code, 'stale-edit');
  assert.deepEqual(error.payload, { comment: currentComment });
  const reconciliation = api.calls.at(-1);
  assert.ok(reconciliation?.url.includes('property_id=eq.' + property));
  assert.equal(reconciliation?.method, 'GET');
});

test('a denied author stays an access error and a rejected body an invalid input', async () => {
  const denied = stubApi({
    rows: [{ property_id: property }],
    rpc: () => json({ code: '42501', message: 'author required' }, 403),
  });
  assert.deepEqual(
    await refused(() =>
      editComment(context(denied.fake), property, commentId, draft),
    ).then((error) => [error.status, error.code]),
    [403, 'access-denied'],
  );
  const rejected = stubApi({
    rows: [{ property_id: property }],
    rpc: () => json({ code: '23514', message: 'text must change' }, 400),
  });
  assert.deepEqual(
    await refused(() =>
      editComment(context(rejected.fake), property, commentId, draft),
    ).then((error) => [error.status, error.code]),
    [400, 'invalid-input'],
  );
});

test('invalid drafts are rejected locally without any request', async () => {
  const api = stubApi({ rows: [{ property_id: property }] });
  for (const invalid of [
    { body: '   ', revision: originalRevision },
    { body: 'a'.repeat(2001), revision: originalRevision },
    { body: 'Đổi nội dung' },
    { body: 'Đổi nội dung', revision: 'not-a-revision' },
    { body: 'Đổi nội dung', revision: originalRevision, property_id: property },
  ])
    assert.equal(
      (
        await refused(() =>
          editComment(context(api.fake), property, commentId, invalid),
        )
      ).status,
      400,
    );
  assert.equal(api.calls.length, 0);
});

test('the route answers a mismatched Property path with the existing not-found shape', async (t) => {
  const api = stubApi({ rows: [{ property_id: property }] });
  t.mock.method(globalThis, 'fetch', api.fake);
  const response = await routePost(otherProperty);
  assert.deepEqual(
    [response.status, await response.json()],
    [404, { error: 'not-found' }],
  );
  assert.equal(
    api.calls.some((call) => call.url.includes('/rpc/edit_property_comment')),
    false,
  );
});

test('the route answers a stale save with the reconciliation payload', async (t) => {
  const api = stubApi({
    rows: [{ property_id: property }],
    rpc: () =>
      json(
        { code: 'PT409', message: 'stale revision', details: null, hint: null },
        409,
      ),
    conflictRows: [currentRow],
  });
  t.mock.method(globalThis, 'fetch', api.fake);
  const response = await routePost(property);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: 'stale-edit',
    comment: currentComment,
  });
});

test('the route saves through the real session and never caches the response publicly', async (t) => {
  const api = stubApi({ rows: [{ property_id: property }] });
  t.mock.method(globalThis, 'fetch', api.fake);
  const response = await routePost(property);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { comment: currentComment });
  assert.equal(
    response.headers.get('cache-control'),
    'private, no-store, max-age=0',
  );
});
