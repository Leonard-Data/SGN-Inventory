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
