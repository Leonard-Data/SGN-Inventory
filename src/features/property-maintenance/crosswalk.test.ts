import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  crosswalkMessage,
  offeredCrosswalkRow,
  type CrosswalkOutcome,
} from './crosswalk.ts';

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

test('only a single whole or rename row is offered as the current ward', () => {
  assert.deepEqual(offeredCrosswalkRow([{ relation: 'whole' }]), {
    relation: 'whole',
  });
  assert.deepEqual(offeredCrosswalkRow([{ relation: 'rename' }]), {
    relation: 'rename',
  });
  // A partial transfer splits one old ward over several new ones, and more than one row cannot be
  // chosen between: neither is a target the form may write.
  assert.equal(offeredCrosswalkRow([{ relation: 'partial' }]), null);
  assert.equal(
    offeredCrosswalkRow([{ relation: 'whole' }, { relation: 'partial' }]),
    null,
  );
  assert.equal(offeredCrosswalkRow([]), null);
});

test('the single target is named with its current ward and province', () => {
  const outcome: CrosswalkOutcome = {
    kind: 'mapped',
    commune: 'Phường Bến Thành',
    province: 'Thành phố Hồ Chí Minh',
  };
  assert.equal(
    crosswalkMessage('vi', outcome),
    'Phường/xã cũ đã chuyển thành Phường Bến Thành, Thành phố Hồ Chí Minh.',
  );
  assert.equal(
    crosswalkMessage('en', outcome),
    'The old ward became Phường Bến Thành, Thành phố Hồ Chí Minh.',
  );
  // Official unit names are source data: neither language translates or rewrites them.
  for (const locale of ['vi', 'en'] as const)
    assert.match(crosswalkMessage(locale, outcome), /Phường Bến Thành/);
});

test('several targets are reported with the count and nothing is offered', () => {
  assert.equal(
    crosswalkMessage('vi', { kind: 'several', count: 3 }),
    'Cần xác minh phường mới: bảng chuyển đổi ghi nhận 3 phường/xã mới.',
  );
  assert.equal(
    crosswalkMessage('en', { kind: 'several', count: 3 }),
    'The new ward needs verification: the crosswalk records 3 new wards.',
  );
});

test('a ward with no crosswalk row says so plainly', () => {
  assert.equal(
    crosswalkMessage('vi', { kind: 'none' }),
    'Chưa có bảng chuyển đổi cho phường/xã cũ này.',
  );
  assert.equal(
    crosswalkMessage('en', { kind: 'none' }),
    'No crosswalk is available for this old ward.',
  );
});

test('the three outcomes are worded distinguishably in both languages', () => {
  const outcomes: CrosswalkOutcome[] = [
    { kind: 'mapped', commune: 'Xã A', province: 'Tỉnh B' },
    { kind: 'several', count: 2 },
    { kind: 'none' },
  ];
  for (const locale of ['vi', 'en'] as const) {
    const messages = outcomes.map((outcome) =>
      crosswalkMessage(locale, outcome),
    );
    assert.equal(new Set(messages).size, outcomes.length, locale);
    // Only the offered outcome names a ward the person could record.
    assert.match(messages[0]!, /Xã A/);
    assert.doesNotMatch(messages[1]!, /Xã A/);
    assert.match(messages[1]!, /2/);
  }
});

test('the one offered action is a confirmation the person makes, behind its own route', () => {
  const offer = source('./crosswalk-offer.tsx');
  const route = source(
    '../../app/api/properties/[id]/address-candidate/route.ts',
  );
  const createScreen = source('./create.tsx');
  // Only the offered outcome renders a control at all, so a partial or absent mapping can never be
  // recorded from this panel.
  assert.match(offer, /crosswalk\.kind === 'mapped' \?/);
  assert.match(offer, /address-candidate/);
  assert.match(offer, /addressId: address\.addressId/);
  assert.match(offer, /propertyRevision: address\.propertyRevision/);
  // The route records the candidate through the one database operation; it writes no address of
  // its own and trusts no target from the request.
  assert.match(route, /recordCandidate\(/);
  assert.doesNotMatch(route, /target|province_unit_id|commune_unit_id/);
  // A legacy save keeps its confirmation on screen instead of leaving for the record page, because
  // that panel is where the crosswalk outcome is reported.
  assert.match(createScreen, /if \(result\.address\) \{/);
  assert.match(createScreen, /<CrosswalkOffer/);
});
