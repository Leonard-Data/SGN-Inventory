import assert from 'node:assert/strict';
import test from 'node:test';
import { addressNotes, type RecordedAddress } from './address-notes.ts';
import type { CrosswalkOutcome } from '../property-maintenance/crosswalk';

const PROVINCE = '11111111-1111-4111-8111-111111111111';
const DISTRICT = '22222222-2222-4222-8222-222222222222';
const LEGACY_WARD = '33333333-3333-4333-8333-333333333333';
const CURRENT_WARD = '44444444-4444-4444-8444-444444444444';

const names = new Map([
  [PROVINCE, 'Thành phố Hồ Chí Minh'],
  [DISTRICT, 'Quận Bình Thạnh'],
  [LEGACY_WARD, 'Phường 22'],
  [CURRENT_WARD, 'Phường Thạnh Mỹ Tây'],
]);

function address(parts: Partial<RecordedAddress> = {}): RecordedAddress {
  return {
    format: 'legacy',
    province_unit_id: PROVINCE,
    district_unit_id: DISTRICT,
    commune_unit_id: LEGACY_WARD,
    ...parts,
  };
}

test('a legacy address reads as its recorded hierarchy, largest tier first', () => {
  const notes = addressNotes(
    address(),
    names,
    new Map<string, CrosswalkOutcome | null>(),
  );
  assert.equal(
    notes.hierarchy,
    'Thành phố Hồ Chí Minh · Quận Bình Thạnh · Phường 22',
  );
});

test('a tier the address did not record is left out, never taken from the text', () => {
  const notes = addressNotes(
    address({ district_unit_id: null }),
    names,
    new Map(),
  );
  assert.equal(notes.hierarchy, 'Thành phố Hồ Chí Minh · Phường 22');
  assert.equal(
    addressNotes(
      address({
        province_unit_id: null,
        district_unit_id: null,
        commune_unit_id: null,
      }),
      names,
      new Map(),
    ).hierarchy,
    '',
  );
  // A recorded identifier the catalog cannot name contributes nothing rather than an identifier.
  assert.equal(
    addressNotes(address({ district_unit_id: 'unknown' }), names, new Map())
      .hierarchy,
    'Thành phố Hồ Chí Minh · Phường 22',
  );
});

test('the crosswalk state belongs to the legacy ward it was recorded at', () => {
  const recorded = new Map<string, CrosswalkOutcome | null>([
    [
      LEGACY_WARD,
      {
        kind: 'mapped',
        commune: 'Phường Thạnh Mỹ Tây',
        province: 'Thành phố Hồ Chí Minh',
      },
    ],
    [CURRENT_WARD, { kind: 'none' }],
  ]);
  assert.deepEqual(addressNotes(address(), names, recorded).crosswalk, {
    kind: 'mapped',
    commune: 'Phường Thạnh Mỹ Tây',
    province: 'Thành phố Hồ Chí Minh',
  });
  // The three outcomes of the save surface, and nothing when the ward's state could not be read.
  assert.deepEqual(
    addressNotes(address({ commune_unit_id: CURRENT_WARD }), names, recorded)
      .crosswalk,
    { kind: 'none' },
  );
  assert.equal(
    addressNotes(address({ commune_unit_id: null }), names, recorded).crosswalk,
    null,
  );
  assert.equal(
    addressNotes(
      address({ commune_unit_id: 'unreadable' }),
      names,
      new Map([['unreadable', null]]),
    ).crosswalk,
    null,
  );
});

test('a current address states no hierarchy and asks no crosswalk', () => {
  const notes = addressNotes(
    address({
      format: 'current',
      district_unit_id: null,
      commune_unit_id: CURRENT_WARD,
    }),
    names,
    new Map([[CURRENT_WARD, { kind: 'none' }]]),
  );
  assert.equal(notes.hierarchy, '');
  assert.equal(notes.crosswalk, null);
});
