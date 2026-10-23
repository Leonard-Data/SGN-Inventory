import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correctionFieldNames } from '../property-maintenance/fields.ts';

function propertyNames(staff: boolean, propertyStatus: string) {
  return correctionFieldNames({ target: 'property', staff, propertyStatus });
}

test('property corrections keep the other facts and the status boundary', () => {
  const names = propertyNames(true, 'available');
  for (const name of ['listing_mode', 'sale_price_vnd', 'notes', 'status'])
    assert.ok(names.includes(name), name);
  assert.equal(propertyNames(true, 'sold').includes('status'), false);
  assert.equal(propertyNames(true, 'rented').includes('status'), false);
});

test('address corrections keep their existing field boundaries', () => {
  const names = correctionFieldNames({
    target: 'address',
    staff: true,
    propertyStatus: 'available',
  });
  // The known address is composed by the server, so a correction never proposes one.
  assert.equal(names.includes('address_text'), false);
  assert.equal(names.includes('district_text'), false);
  // The legacy district is a picker now, so a staff correction can name it; the source labels stay
  // provenance and are never edited.
  assert.ok(names.includes('district_unit_id'));
  for (const name of ['province_text', 'commune_text'])
    assert.equal(names.includes(name), false);

  const current = correctionFieldNames({
    target: 'address',
    staff: true,
    propertyStatus: 'available',
    observedFormat: 'current',
  });
  for (const name of current) assert.equal(name.startsWith('district_'), false);
});

test('non-staff corrections still withhold link and contact identity', () => {
  const names = correctionFieldNames({
    target: 'link',
    staff: false,
    propertyStatus: 'available',
  });
  assert.equal(names.includes('contact_id'), false);
  assert.equal(names.includes('remove'), false);
});
