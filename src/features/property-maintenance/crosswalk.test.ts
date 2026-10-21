import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crosswalkMessage,
  crosswalkReport,
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
    'Phường/xã cũ đang lưu đã chuyển thành Phường Bến Thành, Thành phố Hồ Chí Minh.',
  );
  assert.equal(
    crosswalkMessage('en', outcome),
    'The old ward saved here became Phường Bến Thành, Thành phố Hồ Chí Minh.',
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
    'Chưa có bảng chuyển đổi cho phường/xã cũ đang lưu.',
  );
  assert.equal(
    crosswalkMessage('en', { kind: 'none' }),
    'No crosswalk is available for the old ward saved here.',
  );
});

test('a ward whose current address is already recorded says so instead', () => {
  assert.equal(
    crosswalkMessage('vi', { kind: 'recorded' }),
    'Địa chỉ mới cho phường/xã cũ đang lưu đã được ghi trước đó.',
  );
  assert.equal(
    crosswalkMessage('en', { kind: 'recorded' }),
    'The current address for the old ward saved here is already recorded.',
  );
});

test('the saved ward decides the report: its own mapping, or the state recorded for it', () => {
  type Row = {
    id: string;
    format: string;
    commune_unit_id: string | null;
    supersedes_address_id: string | null;
  };
  const row = (
    id: string,
    format: string,
    commune_unit_id: string | null = null,
    supersedes_address_id: string | null = null,
  ): Row => ({ id, format, commune_unit_id, supersedes_address_id });
  const mapped: CrosswalkOutcome = {
    kind: 'mapped',
    commune: 'Phường Bến Thành',
    province: 'Thành phố Hồ Chí Minh',
  };
  // One property with two legacy addresses at different wards, each able to record its own
  // candidate: the link answers for the row it came from, not for the property.
  const base: Row[] = [
    row('legacy-a', 'legacy', 'ward-1'),
    row('legacy-b', 'legacy', 'ward-2'),
    row('current-a', 'current', 'new-1', 'legacy-a'),
  ];
  // The ward the saved row names maps to the target the chain recorded, so the surface says the
  // recorded state and offers no action.
  assert.deepEqual(crosswalkReport(base, 'legacy-a', mapped, 'new-1'), {
    kind: 'recorded',
  });
  assert.equal(
    crosswalkMessage('en', crosswalkReport(base, 'legacy-a', mapped, 'new-1')),
    'The current address for the old ward saved here is already recorded.',
  );
  // A correction of the legacy row inserts its successor, which is the row a later save reports.
  const corrected: Row[] = [
    ...base,
    row('legacy-a2', 'legacy', 'ward-3', 'legacy-a'),
  ];
  // The ward the corrected row now names is not the one the chain recorded: the surface reports what
  // that ward maps to, so its one action is available, and the same state as before is recognised.
  assert.deepEqual(
    crosswalkReport(corrected, 'legacy-a2', mapped, 'new-2'),
    mapped,
  );
  assert.deepEqual(crosswalkReport(corrected, 'legacy-a2', mapped, 'new-1'), {
    kind: 'recorded',
  });
  // A ward the crosswalk names no single target for has nothing recorded, and nothing is offered.
  assert.deepEqual(
    crosswalkReport(
      corrected,
      'legacy-a2',
      { kind: 'several', count: 2 },
      null,
    ),
    { kind: 'several', count: 2 },
  );
  assert.deepEqual(
    crosswalkReport(corrected, 'legacy-a2', { kind: 'none' }, null),
    { kind: 'none' },
  );
  // An unrelated legacy address stays unrecorded, nothing is recorded before the action runs, and an
  // alternate variant is not a recorded current address.
  assert.deepEqual(
    crosswalkReport(corrected, 'legacy-b', mapped, 'new-2'),
    mapped,
  );
  assert.deepEqual(
    crosswalkReport(
      [row('legacy-a', 'legacy', 'ward-1')],
      'legacy-a',
      mapped,
      'new-1',
    ),
    mapped,
  );
  assert.deepEqual(crosswalkReport([], 'legacy-a', mapped, 'new-1'), mapped);
  assert.deepEqual(
    crosswalkReport(
      [
        row('legacy-a', 'legacy', 'ward-1'),
        row('alternate-a', 'alternate', 'new-1', 'legacy-a'),
      ],
      'legacy-a',
      mapped,
      'new-1',
    ),
    mapped,
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
