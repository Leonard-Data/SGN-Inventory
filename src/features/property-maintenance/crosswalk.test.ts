import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conversionTarget,
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
  // What each recorded unit id is, by official code: a renamed unit keeps its code but gets a new
  // version row, so two ids can name the same territory.
  const codes = new Map([
    ['new-1', 'CODE-1'],
    ['new-1-later', 'CODE-1'],
    ['new-2', 'CODE-2'],
  ]);
  const row = (
    format: string,
    commune_unit_id: string | null,
  ): { format: string; commune_unit_id: string | null } => ({
    format,
    commune_unit_id,
  });
  // One property with two legacy addresses at different wards, each able to record its own
  // candidate: a recorded current row answers only for the territory its unit names.
  const rows = [
    row('legacy', 'ward-1'),
    row('legacy', 'ward-2'),
    row('current', 'new-1'),
  ];
  // The saved ward maps to the territory the property already records, so the surface says the
  // recorded state and offers no action.
  assert.equal(crosswalkRecorded(rows, 'CODE-1', codes), true);
  // A correction of the legacy row inserts a successor that supersedes nothing the current row
  // names, and the ward a later save reports can be another territory: that ward is its own
  // candidate, so the action is offered again for it.
  assert.equal(
    crosswalkRecorded([...rows, row('legacy', 'ward-3')], 'CODE-2', codes),
    false,
  );
  // A conversion writes the legacy row from the current one, and a correction of that legacy row
  // moves the supersedes chain on without the current row it came from naming the successor: the
  // territory is what is recorded, so the reversed conversion's own current row still answers.
  assert.equal(
    crosswalkRecorded(
      [row('current', 'new-1'), row('legacy', 'ward-1'), row('legacy', 'ward-1')],
      'CODE-1',
      codes,
    ),
    true,
  );
  // The target recorded in a later validity window of the same unit is the same territory.
  assert.equal(
    crosswalkRecorded([row('current', 'new-1-later')], 'CODE-1', codes),
    true,
  );
  // Nothing is recorded before the action runs, a legacy or alternate row is never a recorded
  // current address, another commune is another territory, and a ward the crosswalk names no
  // single target for records nothing.
  assert.equal(
    crosswalkRecorded([row('legacy', 'ward-1')], 'CODE-1', codes),
    false,
  );
  assert.equal(
    crosswalkRecorded([row('alternate', 'new-1')], 'CODE-1', codes),
    false,
  );
  assert.equal(
    crosswalkRecorded([row('current', 'new-2')], 'CODE-1', codes),
    false,
  );
  assert.equal(crosswalkRecorded([row('current', 'new-1')], undefined, codes), false);
  assert.equal(crosswalkRecorded([], 'CODE-1', codes), false);
});

test('only the two geographies a crosswalk relates are convertible, and a row offers the other one', () => {
  assert.equal(conversionTarget('legacy'), 'current');
  assert.equal(conversionTarget('current'), 'legacy');
  // An unmatched or alternate row is a source record the crosswalk says nothing about.
  assert.equal(conversionTarget('alternate'), null);
  assert.equal(conversionTarget(''), null);
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
