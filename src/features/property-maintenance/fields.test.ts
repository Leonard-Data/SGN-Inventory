import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateChanges, formChanges } from './fields.ts';

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
  for (const changes of [
    { latitude: '91' },
    { latitude: '-90.0000001' },
    { longitude: '181' },
    { longitude: '-180.0000001' },
    { latitude: '10.76262200' }, // eight decimals exceed numeric(10,7)
    { latitude: 'abc' },
    { latitude: '10.' },
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
});
