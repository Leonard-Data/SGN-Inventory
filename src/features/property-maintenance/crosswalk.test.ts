import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crosswalkMessage,
  crosswalkRecorded,
  offeredCrosswalkRow,
  type CrosswalkOutcome,
} from './crosswalk.ts';

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
  // One partial successor is one target that needs verifying, not several: the sentence keeps
  // stating what the crosswalk actually holds in both languages.
  assert.equal(
    crosswalkMessage('vi', { kind: 'several', count: 1 }),
    'Cần xác minh phường mới: bảng chuyển đổi ghi nhận 1 phường/xã mới.',
  );
  assert.equal(
    crosswalkMessage('en', { kind: 'several', count: 1 }),
    'The new ward needs verification: the crosswalk records 1 new ward.',
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

test('a ward whose current address is already recorded says so instead', () => {
  assert.equal(
    crosswalkMessage('vi', { kind: 'recorded' }),
    'Địa chỉ mới cho phường/xã cũ này đã được ghi trước đó.',
  );
  assert.equal(
    crosswalkMessage('en', { kind: 'recorded' }),
    'The current address for this old ward is already recorded.',
  );
});

test('a recorded current address is recognised through the legacy row superseded chain', () => {
  type Row = {
    id: string;
    format: string;
    supersedes_address_id: string | null;
  };
  const row = (
    id: string,
    format: string,
    supersedes_address_id: string | null = null,
  ): Row => ({ id, format, supersedes_address_id });
  // One property with two legacy addresses at different wards, each able to record its own
  // candidate: the link answers for the row it came from, not for the property.
  const base: Row[] = [
    row('legacy-a', 'legacy'),
    row('legacy-b', 'legacy'),
    row('current-a', 'current', 'legacy-a'),
  ];
  assert.equal(crosswalkRecorded(base, 'legacy-a'), true);
  assert.equal(crosswalkRecorded(base, 'legacy-b'), false);
  // A correction of the legacy row inserts its successor, which is the row a later save reports:
  // the recorded state follows the chain in both directions.
  const corrected = [...base, row('legacy-a2', 'legacy', 'legacy-a')];
  assert.equal(crosswalkRecorded(corrected, 'legacy-a2'), true);
  assert.equal(crosswalkRecorded(corrected, 'legacy-a'), true);
  // An unrelated legacy address stays unrecorded, and nothing is recorded before the action runs.
  assert.equal(crosswalkRecorded(corrected, 'legacy-b'), false);
  assert.equal(
    crosswalkRecorded([row('legacy-a', 'legacy')], 'legacy-a'),
    false,
  );
  assert.equal(crosswalkRecorded([], 'legacy-a'), false);
  // An alternate variant is not a recorded current address.
  assert.equal(
    crosswalkRecorded(
      [row('legacy-a', 'legacy'), row('alternate-a', 'alternate', 'legacy-a')],
      'legacy-a',
    ),
    false,
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
