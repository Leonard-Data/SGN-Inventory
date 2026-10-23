import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_CATALOG_START,
  FIXED_PROVINCE,
  LEGACY_CATALOG_DAY,
  clearedUnits,
  filledDistrictText,
  generationRow,
  offeredUnits,
  pickedDistrict,
  pickedProvinceRow,
  statedProvince,
  unitOfferedOn,
  unitOptionLabels,
  unitParent,
} from './units.ts';

// The one province the app states: every address surface names this unit instead of offering a
// choice, so the tests pin the identifier and its name.
test('the app states one province', () => {
  assert.equal(FIXED_PROVINCE.id, 'cc2ace6d-f3e8-424c-9105-a560983abae0');
  assert.equal(FIXED_PROVINCE.name, 'Thành phố Hồ Chí Minh');
});

test('an address form submits the stated province and keeps a recorded one', () => {
  // A new address, and a recorded one that holds the stated province, both submit it.
  assert.equal(statedProvince(undefined), FIXED_PROVINCE.id);
  assert.equal(statedProvince(null), FIXED_PROVINCE.id);
  assert.equal(statedProvince('  '), FIXED_PROVINCE.id);
  assert.equal(statedProvince(FIXED_PROVINCE.id), FIXED_PROVINCE.id);
  // A record that already stores another province keeps exactly what it recorded.
  assert.equal(
    statedProvince('11111111-1111-4111-8111-111111111111'),
    '11111111-1111-4111-8111-111111111111',
  );
});

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

test("a pick beneath the province records that level's own province row", () => {
  const legacyRow = '88888888-8888-4888-8888-888888888888';
  // A legacy address's district hangs off the pre-2025 row of the same stated province, and the
  // database guard requires the address to record exactly that parent, so the pick states it.
  assert.equal(
    pickedProvinceRow(FIXED_PROVINCE.id, { parent_id: legacyRow }),
    legacyRow,
  );
  // A pick whose row carries no parent, and no pick at all, leave the province as it stands.
  assert.equal(
    pickedProvinceRow(FIXED_PROVINCE.id, { parent_id: null }),
    FIXED_PROVINCE.id,
  );
  assert.equal(
    pickedProvinceRow(FIXED_PROVINCE.id, undefined),
    FIXED_PROVINCE.id,
  );
  assert.equal(pickedProvinceRow(legacyRow, undefined), legacyRow);
});

test('a read resolves one official unit to the row its generation reads', () => {
  const legacy = {
    id: 'legacy-row',
    valid_from: LEGACY_CATALOG_DAY,
    valid_to: CURRENT_CATALOG_START,
  };
  const current = {
    id: 'current-row',
    valid_from: CURRENT_CATALOG_START,
    valid_to: null,
  };
  // A legacy day reads the pre-2025 row of the unit, a current day or no stated day the current one.
  assert.equal(
    generationRow([legacy, current], LEGACY_CATALOG_DAY)?.id,
    legacy.id,
  );
  assert.equal(generationRow([legacy, current], null)?.id, current.id);
  assert.equal(generationRow([legacy, current], '2026-10-23')?.id, current.id);
  assert.equal(generationRow([current], LEGACY_CATALOG_DAY), undefined);
});

test('a legacy ward narrows by its district and a current commune by the stated province', () => {
  const chosen = { province: FIXED_PROVINCE.id, district: 'd', commune: '' };
  assert.equal(unitParent('legacy', 'commune', chosen), 'd');
  assert.equal(unitParent('legacy', 'district', chosen), FIXED_PROVINCE.id);
  // Without a district the ward list has no parent, so it cannot offer a ward from another
  // district and stays unloaded until one is chosen.
  assert.equal(
    unitParent('legacy', 'commune', {
      province: FIXED_PROVINCE.id,
      district: '',
      commune: '',
    }),
    undefined,
  );
  // A current commune narrows by the stated province; its district field carries nothing.
  assert.equal(unitParent('current', 'commune', chosen), FIXED_PROVINCE.id);
  assert.equal(unitParent('current', 'district', chosen), FIXED_PROVINCE.id);
});

test('picking a level clears the levels beneath it and a format switch keeps the province', () => {
  assert.deepEqual(
    pickedDistrict(
      { province: FIXED_PROVINCE.id, district: '', commune: 'w' },
      'd',
    ),
    { province: FIXED_PROVINCE.id, district: 'd', commune: '' },
  );
  // A cleared form keeps the one stated province: only the levels picked beneath it are cleared.
  assert.deepEqual(clearedUnits(), {
    province: FIXED_PROVINCE.id,
    district: '',
    commune: '',
  });
});

test('re-picking the unit a level already holds keeps the recorded levels beneath it', () => {
  const recorded = { province: FIXED_PROVINCE.id, district: 'd', commune: 'w' };
  assert.deepEqual(pickedDistrict(recorded, 'd'), recorded);
  // Only an actual change of value replaces the stored ones.
  assert.deepEqual(pickedDistrict(recorded, 'other'), {
    province: FIXED_PROVINCE.id,
    district: 'other',
    commune: '',
  });
});

test('a district pick repairs an imported label and leaves the picked name alone', () => {
  // Nothing recorded yet: a pick fills the field.
  assert.equal(filledDistrictText('', 'Quận 1'), 'Quận 1');
  assert.equal(filledDistrictText('   ', 'Quận 1'), 'Quận 1');
  // A label that is not the picked district's official name, an imported shorthand included, is
  // replaced: the picker is the only writer of the field, so a re-pick repairs it.
  assert.equal(filledDistrictText('Q. Bình Thạnh', 'Bình Thạnh'), 'Bình Thạnh');
  assert.equal(
    filledDistrictText('Quận 1, phường Bến Thành', 'Quận 3'),
    'Quận 3',
  );
  // A province change clears the label with the district it described.
  assert.equal(filledDistrictText('Quận 1', ''), '');
  // The field already reads the picked district's official name, so the pick changes nothing.
  assert.equal(filledDistrictText(' Quận 1 ', 'Quận 1'), null);
  assert.equal(filledDistrictText('', ''), null);
});

test('a format switch clears the district label with the units it described', () => {
  // Switching legacy → current → legacy drops the picked levels beneath the stated province and the
  // label the picker wrote for the district they named, so no label is left without its unit.
  assert.equal(clearedUnits().district, '');
  assert.equal(filledDistrictText('Bình Thạnh', ''), '');
});

test('a picker offers the unit an address recorded before this entry still holds', () => {
  const legacyProvince = {
    id: 'legacy-province',
    name_vi: 'Tỉnh Bình Dương',
    valid_from: '2025-01-04',
    valid_to: '2025-07-01',
  };
  const recordedProvince = {
    id: 'current-province',
    name_vi: 'Thành phố Hồ Chí Minh',
    valid_from: '2025-07-01',
    valid_to: null,
  };
  const recordedWard = {
    id: 'current-ward',
    name_vi: 'Phường Bến Thành',
    valid_from: '2025-07-01',
    valid_to: null,
  };
  // The legacy day hides the current generation, but the recorded id stays offered with its own
  // official name, and it stays the value the form submits.
  assert.deepEqual(
    offeredUnits(
      [legacyProvince, recordedProvince],
      LEGACY_CATALOG_DAY,
      recordedProvince.id,
    ),
    [legacyProvince, recordedProvince],
  );
  assert.deepEqual(
    offeredUnits([recordedWard], LEGACY_CATALOG_DAY, recordedWard.id),
    [recordedWard],
  );
  assert.deepEqual(
    offeredUnits([legacyProvince, recordedProvince], LEGACY_CATALOG_DAY, ''),
    [legacyProvince],
  );
});

test('the legacy pickers read the day the pre-2025 list opened', () => {
  assert.equal(LEGACY_CATALOG_DAY, '2025-01-04');
  // That day falls inside the closed legacy window and before the current generation, which is
  // what makes one read answer with the 63 provinces, their districts and their wards.
  assert.equal(
    unitOfferedOn(
      { valid_from: '2025-01-04', valid_to: '2025-07-01' },
      LEGACY_CATALOG_DAY,
    ),
    true,
  );
  assert.equal(
    unitOfferedOn(
      { valid_from: '2025-07-01', valid_to: null },
      LEGACY_CATALOG_DAY,
    ),
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
