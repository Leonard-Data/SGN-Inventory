import { test } from 'node:test';
import assert from 'node:assert/strict';
import { label } from '../../i18n/messages.ts';
import {
  addressFields,
  validateChanges,
  formChanges,
  correctionFieldNames,
  targetFields,
} from './fields.ts';

const LEGACY_PROVINCE = '11111111-1111-4111-8111-111111111111',
  LEGACY_DISTRICT = '22222222-2222-4222-8222-222222222222',
  LEGACY_WARD = '33333333-3333-4333-8333-333333333333',
  CURRENT_PROVINCE = '44444444-4444-4444-8444-444444444444',
  CURRENT_WARD = '55555555-5555-4555-8555-555555555555',
  OTHER_WARD = '66666666-6666-4666-8666-666666666666';

function legacyForm() {
  const form = new FormData();
  form.set('format', 'legacy');
  form.set('address_text', '12 Nguyễn Du, Quận 1');
  form.set('district_text', 'Quận 1');
  form.set('province_unit_id', LEGACY_PROVINCE);
  form.set('district_unit_id', LEGACY_DISTRICT);
  form.set('commune_unit_id', LEGACY_WARD);
  return form;
}

test('the two address formats read in both languages and keep a recorded district', () => {
  assert.equal(label('vi', 'legacy'), 'Địa chỉ cũ');
  assert.equal(label('en', 'legacy'), 'Legacy Address');
  assert.equal(label('vi', 'current'), 'Địa chỉ mới');
  assert.equal(label('en', 'current'), 'Current Address');
  // The district text travels with the form the picker writes it into, so a save that changes
  // something else leaves the recorded text out of the changes rather than clearing it.
  const form = legacyForm();
  form.set('house_number', '14');
  assert.deepEqual(
    formChanges('address', form, {
      format: 'legacy',
      address_text: '12 Nguyễn Du, Quận 1',
      house_number: '12',
      district_text: 'Quận 1',
      province_unit_id: LEGACY_PROVINCE,
      district_unit_id: LEGACY_DISTRICT,
      commune_unit_id: LEGACY_WARD,
    }),
    { house_number: '14' },
  );
});

test('a legacy address saves all three unit ids and its district text', () => {
  assert.deepEqual(formChanges('address', legacyForm()), {
    format: 'legacy',
    address_text: '12 Nguyễn Du, Quận 1',
    district_text: 'Quận 1',
    province_unit_id: LEGACY_PROVINCE,
    district_unit_id: LEGACY_DISTRICT,
    commune_unit_id: LEGACY_WARD,
  });
  // mapping_status is not an address field: the column default records an unresolved mapping, so
  // a legacy address can never be saved as verified through the form.
  assert.equal(targetFields.address.includes('mapping_status'), false);
});

test('an edited address whose recorded units are unchanged submits nothing', () => {
  assert.deepEqual(
    formChanges('address', legacyForm(), {
      format: 'legacy',
      address_text: '12 Nguyễn Du, Quận 1',
      district_text: 'Quận 1',
      province_unit_id: LEGACY_PROVINCE,
      district_unit_id: LEGACY_DISTRICT,
      commune_unit_id: LEGACY_WARD,
    }),
    {},
  );
});

test('a legacy address recorded with current-generation units keeps them and saves a change', () => {
  const recorded = {
    format: 'legacy',
    address_text: '12 Nguyễn Du, Quận 1',
    district_text: 'Quận 1',
    province_unit_id: CURRENT_PROVINCE,
    commune_unit_id: CURRENT_WARD,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(recorded)) form.set(key, value);
  // Saving without edits submits neither the out-of-generation province nor the recorded ward, so
  // the row keeps exactly the units it holds.
  assert.deepEqual(formChanges('address', form, recorded), {});
  form.set('commune_unit_id', OTHER_WARD);
  assert.deepEqual(formChanges('address', form, recorded), {
    commune_unit_id: OTHER_WARD,
  });
});

test('a current address still refuses a district id as well as district text', () => {
  for (const changes of [
    {
      format: 'current',
      address_text: '12 Nguyễn Du',
      district_unit_id: LEGACY_DISTRICT,
    },
    {
      format: 'current',
      address_text: '12 Nguyễn Du',
      district_text: 'Quận 1',
    },
  ])
    assert.throws(() => validateChanges('address', changes));
  // A legacy address with a district is valid.
  assert.deepEqual(
    validateChanges('address', {
      format: 'legacy',
      address_text: '12 Nguyễn Du, Quận 1',
      district_unit_id: LEGACY_DISTRICT,
    }),
    {
      format: 'legacy',
      address_text: '12 Nguyễn Du, Quận 1',
      district_unit_id: LEGACY_DISTRICT,
    },
  );
});

test('an address form renders its district label wherever it offers the district picker', () => {
  // The correction draft names the correctable fields and not the label, while the picker that
  // writes the label is still offered, so the label rides along with the picker.
  const names = addressFields(['address_text', 'district_unit_id'], true);
  assert.ok(names.includes('district_text'));
  // A label the picker wrote through those rendered fields reaches the save.
  const form = new FormData();
  for (const name of names)
    form.set(name, name === 'district_text' ? 'Bình Thạnh' : 'x');
  assert.equal(
    formChanges('address', form, { district_text: 'Quận 1' }).district_text,
    'Bình Thạnh',
  );
  // A selection that offers no district picker renders no label, and neither does a current
  // address even when a caller names one.
  assert.equal(
    addressFields(['address_text'], true).includes('district_text'),
    false,
  );
  const current = addressFields(['address_text', 'district_text'], false);
  assert.equal(current.includes('district_text'), false);
  assert.ok(current.includes('address_text'));
  // A caller naming no fields gets every one of them.
  assert.ok(addressFields(undefined, true).includes('district_text'));
});

test('a staff address correction can name the legacy district unit', () => {
  const names = correctionFieldNames({
    target: 'address',
    staff: true,
    propertyStatus: 'available',
  });
  for (const name of ['address_text', 'district_unit_id'])
    assert.ok(names.includes(name), name);
  // The district label is written by the picker, so a correction never offers it, and the source
  // labels stay provenance.
  for (const name of ['province_text', 'district_text', 'commune_text'])
    assert.equal(names.includes(name), false);
  // A current address has no district level at all, so it offers no district field.
  const current = correctionFieldNames({
    target: 'address',
    staff: true,
    propertyStatus: 'available',
    observedFormat: 'current',
  });
  for (const name of current) assert.equal(name.startsWith('district_'), false);
});

test('maintenance boundary preserves exact money, decimals and source phone/text', () => {
  assert.deepEqual(
    validateChanges('property', {
      sale_price_vnd: '999999999999999999',
      land_area_m2: '1234.50',
      notes: 'Nguồn tiếng Việt',
    }),
    {
      sale_price_vnd: '999999999999999999',
      land_area_m2: '1234.50',
      notes: 'Nguồn tiếng Việt',
    },
  );
  assert.deepEqual(
    validateChanges('contact', {
      phones: ['0900 123 456', '***789'],
      raw_phone_text: 'Nguồn: ***789',
    }),
    { phones: ['0900 123 456', '***789'], raw_phone_text: 'Nguồn: ***789' },
  );
});
test('maintenance boundary rejects invented authority, unknown fields and rounded numeric input', () => {
  for (const changes of [
    { property_code: 'forged' },
    { legal_status: 'reviewed' },
    { sale_price_vnd: 9007199254740992 },
    { sale_price_vnd: '1.5' },
    { land_area_m2: '1.001' },
    { frontage_m: '1000000' },
    { floors: '32768' },
    { notes: { nested: 'bad' } },
  ])
    assert.throws(() => validateChanges('property', changes));
  assert.throws(() =>
    validateChanges('address', {
      format: 'current',
      address_text: 'Known',
      district_text: 'Quận 1',
    }),
  );
  assert.throws(() => validateChanges('contact', { phones: [123] }));
  assert.throws(() => validateChanges('property', { notes: 'bad\0source' }));
  assert.throws(() =>
    validateChanges('mapping', { effective_on: '2026-02-30' }),
  );
  const invalidBoolean = new FormData();
  invalidBoolean.set('is_primary', 'invented');
  assert.throws(() => formChanges('link', invalidBoolean));
});
test('form changes omit unchanged values, preserve unknowns and do not translate records', () => {
  const unchangedPhones = new FormData();
  const phones = ['Nguồn\n***123', '0900 000 000'];
  unchangedPhones.set('phones', phones.join('\n'));
  assert.deepEqual(formChanges('contact', unchangedPhones, { phones }), {});
  const unchangedCounts = new FormData();
  unchangedCounts.set('floors', '1');
  assert.deepEqual(formChanges('property', unchangedCounts, { floors: 1 }), {});
  const form = new FormData();
  form.set('sale_price_vnd', '999999999999999999');
  form.set('notes', 'Tiếng Việt');
  form.set('land_area_m2', '');
  assert.deepEqual(
    formChanges('property', form, {
      sale_price_vnd: '999999999999999999',
      notes: 'Cũ',
      land_area_m2: null,
    }),
    { notes: 'Tiếng Việt' },
  );
  const clear = new FormData();
  clear.set('sale_price_vnd', '');
  assert.deepEqual(
    formChanges('property', clear, { sale_price_vnd: '12000000' }),
    { sale_price_vnd: null },
  );
});
test('location coordinates accept exact decimal strings within range and reject bad values', () => {
  assert.deepEqual(
    validateChanges('property', {
      latitude: '10.7626220',
      longitude: '106.6601720',
    }),
    { latitude: '10.7626220', longitude: '106.6601720' },
  );
  // Clearing is valid: both null.
  assert.deepEqual(
    validateChanges('property', { latitude: null, longitude: null }),
    {
      latitude: null,
      longitude: null,
    },
  );
  // A change must name both axes, even when the recorded pair stays complete.
  for (const changes of [
    { latitude: '10.5' },
    { longitude: '106.5' },
    { latitude: null },
    { longitude: null },
  ])
    assert.throws(() => validateChanges('property', changes));
  for (const changes of [
    { latitude: '91', longitude: '106.6601720' },
    { latitude: '-90.0000001', longitude: '106.6601720' },
    { latitude: '10.7626220', longitude: '181' },
    { latitude: '10.7626220', longitude: '-180.0000001' },
    { latitude: '10.76262200', longitude: '106.6601720' }, // eight decimals exceed numeric(10,7)
    { latitude: '10.7626220', longitude: '106.66017200' },
    { latitude: 'abc', longitude: '106.6601720' },
    { latitude: '10.7626220', longitude: 'abc' },
    { latitude: '10.', longitude: '106.6601720' },
    { latitude: '10.7626220', longitude: '106.' },
  ])
    assert.throws(() => validateChanges('property', changes));
});
test('location form changes omit an untouched point and emit a cleared point', () => {
  const untouched = new FormData();
  untouched.set('latitude', '10.7626220');
  untouched.set('longitude', '106.6601720');
  assert.deepEqual(
    formChanges('property', untouched, {
      latitude: '10.7626220',
      longitude: '106.6601720',
    }),
    {},
  );
  const cleared = new FormData();
  cleared.set('latitude', '');
  cleared.set('longitude', '');
  assert.deepEqual(
    formChanges('property', cleared, {
      latitude: '10.7626220',
      longitude: '106.6601720',
    }),
    { latitude: null, longitude: null },
  );
  const movedOnly = new FormData();
  movedOnly.set('longitude', '106.7000000');
  assert.deepEqual(
    formChanges('property', movedOnly, {
      latitude: '10.7626220',
      longitude: '106.6601720',
    }),
    { longitude: '106.7000000', latitude: '10.7626220' },
  );
  const retypedOne = new FormData();
  retypedOne.set('latitude', '10.7626220');
  retypedOne.set('longitude', '106.7000000');
  assert.deepEqual(
    formChanges('property', retypedOne, {
      latitude: '10.7626220',
      longitude: '106.6601720',
    }),
    { longitude: '106.7000000', latitude: '10.7626220' },
  );
  const unrecorded = new FormData();
  unrecorded.set('latitude', '10.8000000');
  assert.throws(() => formChanges('property', unrecorded, {}));
});
