import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeGroup, planGroups } from './merge-duplicate-addresses.mjs';

const row = (
  key,
  id,
  propertyCode,
  completeness,
  createdAt = '2025-01-01T00:00:00Z',
  extra = {},
) => ({
  key,
  id,
  property_code: propertyCode,
  created_at: new Date(createdAt),
  address_text: `${key} recorded`,
  completeness,
  reserved: false,
  rented: false,
  pending: false,
  ...extra,
});

const codes = (group) => [
  group.keep.code,
  ...group.folded.map((member) => member.code),
];

test('one shared address folds the less complete record into the most complete one', () => {
  const plan = planGroups([
    row('k', 'a', 'SGN-A', 4),
    row('k', 'b', 'SGN-B', 9),
  ]);
  assert.deepEqual(plan.refused, []);
  assert.equal(plan.groups.length, 1);
  assert.deepEqual(codes(plan.groups[0]), ['SGN-B', 'SGN-A']);
  assert.equal(plan.groups[0].addressText, 'k recorded');
  assert.equal(plan.groups[0].key, 'k');
});

test('an equal completeness is decided by creation and then identity, never by chance', () => {
  const plan = planGroups([
    row('k', 'a', 'SGN-A', 5, '2025-02-01T00:00:00Z'),
    row('k', 'b', 'SGN-B', 5, '2025-01-01T00:00:00Z'),
    row('k', 'c', 'SGN-C', 5, '2025-02-01T00:00:00Z'),
  ]);
  assert.deepEqual(codes(plan.groups[0]), ['SGN-B', 'SGN-A', 'SGN-C']);
});

test('records that share both their addresses are one group, not two', () => {
  const plan = planGroups([
    row('legacy', 'a', 'SGN-A', 7),
    row('legacy', 'b', 'SGN-B', 3),
    row('current', 'a', 'SGN-A', 7),
    row('current', 'b', 'SGN-B', 3),
  ]);
  assert.equal(plan.groups.length, 1);
  assert.deepEqual(codes(plan.groups[0]), ['SGN-A', 'SGN-B']);
});

test('a group with no single shared address key is refused rather than folded across keys', () => {
  const plan = planGroups([
    row('left', 'a', 'SGN-A', 2),
    row('left', 'b', 'SGN-B', 8),
    row('right', 'b', 'SGN-B', 8),
    row('right', 'c', 'SGN-C', 1),
  ]);
  assert.deepEqual(plan.groups, []);
  assert.deepEqual(plan.refused, [
    { codes: ['SGN-A', 'SGN-B', 'SGN-C'], reason: 'no-shared-address-key' },
  ]);
});

test('a lone record and a blank address never form a group', () => {
  assert.deepEqual(planGroups([row('k', 'a', 'SGN-A', 5)]), {
    groups: [],
    refused: [],
  });
  assert.deepEqual(
    planGroups([row('', 'a', 'SGN-A', 5), row('', 'b', 'SGN-B', 5)]),
    { groups: [], refused: [] },
  );
});

test('a second run over the records a fold left behind finds nothing to do', () => {
  const rows = [row('k', 'a', 'SGN-A', 4), row('k', 'b', 'SGN-B', 9)];
  const plan = planGroups(rows);
  const folded = new Set(plan.groups[0].folded.map((member) => member.id));
  assert.deepEqual(planGroups(rows.filter((entry) => !folded.has(entry.id))), {
    groups: [],
    refused: [],
  });
});

test('a record somebody is holding is reported, and the merge function still decides', () => {
  const plan = planGroups([
    row('k', 'a', 'SGN-A', 4, undefined, { reserved: true }),
    row('k', 'b', 'SGN-B', 9),
    row('k', 'c', 'SGN-C', 1, undefined, { pending: true }),
  ]);
  assert.deepEqual(plan.groups[0].blocked, ['reserved', 'pending-request']);
});

test('a merge goes through the application route for the surviving record', async () => {
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        keep: { id: 'b', propertyCode: 'SGN-B' },
        merged: [{ id: 'a', propertyCode: 'SGN-A' }],
        moved: { files: 0, contactLinks: 2, alreadyLinked: 0, history: 0 },
      }),
    };
  };
  const [group] = planGroups([
    row('k', 'a', 'SGN-A', 4),
    row('k', 'b', 'SGN-B', 9),
  ]).groups;
  const outcome = await mergeGroup(
    'https://example.test',
    { cookies: 'sb-1=token' },
    group,
    request,
  );
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://example.test/api/properties/b/duplicates',
  );
  assert.deepEqual(JSON.parse(calls[0].init.body), { merge: ['a'] });
  assert.equal(calls[0].init.headers.cookie, 'sb-1=token');
  assert.equal(calls[0].init.headers.origin, 'https://example.test');
  assert.equal(outcome.merged.merged[0].propertyCode, 'SGN-A');
});

test('a group the merge refuses is reported, and a lost session stops the run', async () => {
  const [group] = planGroups([
    row('k', 'a', 'SGN-A', 4),
    row('k', 'b', 'SGN-B', 9),
  ]).groups;
  const refusal = await mergeGroup(
    'https://example.test',
    { cookies: 'sb-1=token' },
    group,
    async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'pending-reservation' }),
    }),
  );
  assert.deepEqual(refusal, { refusal: '409 pending-reservation' });
  await assert.rejects(
    mergeGroup('https://example.test', { cookies: '' }, group, async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'access-denied' }),
    })),
    /merge refused for SGN-B: 403 access-denied/,
  );
});
