import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitOfferedOn, unitOptionLabels } from './units.ts';

test('an official unit option shows the name alone', () => {
  assert.deepEqual(
    unitOptionLabels([
      {
        name_vi: 'Tỉnh Đồng Nai',
        valid_from: '2025-07-01',
        valid_to: '2026-04-30',
      },
      {
        name_vi: 'Thành phố Đồng Nai',
        valid_from: '2026-04-30',
        valid_to: null,
      },
    ]),
    ['Tỉnh Đồng Nai', 'Thành phố Đồng Nai'],
  );
});

test('a name repeated in one list keeps the dated window that distinguishes it', () => {
  assert.deepEqual(
    unitOptionLabels([
      { name_vi: 'Xã Bình Minh', valid_from: '2025-07-01', valid_to: null },
      { name_vi: 'Xã Bình Minh', valid_from: '2026-09-20', valid_to: null },
      { name_vi: 'Phường Bến Thành', valid_from: '2025-07-01', valid_to: null },
    ]),
    [
      'Xã Bình Minh (2025-07-01 – )',
      'Xã Bình Minh (2026-09-20 – )',
      'Phường Bến Thành',
    ],
  );
});

test('a stated day offers only the unit whose half-open window covers it', () => {
  const legacy = { valid_from: '2025-01-04', valid_to: '2025-07-01' };
  const baseline = { valid_from: '2025-07-01', valid_to: '2026-04-30' };
  const promoted = { valid_from: '2026-04-30', valid_to: null };
  assert.equal(unitOfferedOn(legacy, '2025-01-04'), true);
  assert.equal(unitOfferedOn(legacy, '2025-06-30'), true);
  assert.equal(unitOfferedOn(legacy, '2025-01-03'), false);
  assert.equal(unitOfferedOn(legacy, '2025-07-01'), false);
  assert.equal(unitOfferedOn(baseline, '2025-07-01'), true);
  assert.equal(unitOfferedOn(baseline, '2026-04-29'), true);
  assert.equal(unitOfferedOn(baseline, '2026-04-30'), false);
  assert.equal(unitOfferedOn(promoted, '2026-04-30'), true);
  assert.equal(unitOfferedOn(promoted, '2026-10-21'), true);
});

test('no stated day keeps every current-generation row and never the legacy one', () => {
  assert.equal(
    unitOfferedOn({ valid_from: '2025-07-01', valid_to: '2026-04-30' }, null),
    true,
  );
  assert.equal(
    unitOfferedOn({ valid_from: '2026-04-30', valid_to: null }, null),
    true,
  );
  assert.equal(
    unitOfferedOn({ valid_from: '2025-01-04', valid_to: '2025-07-01' }, null),
    false,
  );
});

test('a picker states the official name of a unit whose 2026 window closed', () => {
  const units = [
    {
      name_vi: 'Tỉnh Đồng Nai',
      valid_from: '2025-07-01',
      valid_to: '2026-04-30',
    },
    {
      name_vi: 'Thành phố Đồng Nai',
      valid_from: '2026-04-30',
      valid_to: null,
    },
  ];
  assert.deepEqual(
    unitOptionLabels(units.filter((unit) => unitOfferedOn(unit, null))),
    ['Tỉnh Đồng Nai', 'Thành phố Đồng Nai'],
  );
  assert.deepEqual(
    unitOptionLabels(units.filter((unit) => unitOfferedOn(unit, '2026-10-21'))),
    ['Thành phố Đồng Nai'],
  );
});
