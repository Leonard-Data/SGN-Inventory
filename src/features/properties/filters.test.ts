import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeFilterCount,
  catalogUnitsMatch,
  filterParams,
  filterRpcArgs,
  noInventoryFilters,
  parseInventoryFilters,
} from './filters.ts';

function parse(values: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) params.set(key, value);
  return parseInventoryFilters(params);
}

test('a complete filter set is applied exactly as the address stated it', () => {
  const result = parse({
    status: 'available',
    mode: 'rent',
    type: 'house',
    addressFormat: 'current',
    priceMin: '5000000',
    priceMax: '25000000',
    areaMin: '45.5',
    areaMax: '120',
    province: '11111111-1111-4111-8111-111111111111',
    ward: '22222222-2222-4222-8222-222222222222',
    contact: '33333333-3333-4333-8333-333333333333',
    createdBy: 'mine',
  });
  assert.ok(result.ok);
  assert.deepEqual(result.filters, {
    status: 'available',
    mode: 'rent',
    type: 'house',
    addressFormat: 'current',
    priceMin: '5000000',
    priceMax: '25000000',
    areaMin: '45.5',
    areaMax: '120',
    province: '11111111-1111-4111-8111-111111111111',
    ward: '22222222-2222-4222-8222-222222222222',
    contact: '33333333-3333-4333-8333-333333333333',
    createdBy: 'mine',
  });
});

// The address format is always stated, so a search always names the address it reads through, or
// states the choice that applies no format condition.
test('the address format is the legacy address unless the address states another choice', () => {
  const unstated = parse({});
  assert.ok(unstated.ok);
  assert.equal(unstated.filters.addressFormat, 'legacy');
  assert.equal(parse({ addressFormat: 'legacy' }).ok, true);
  const current = parse({ addressFormat: 'current' });
  assert.ok(current.ok);
  assert.equal(current.filters.addressFormat, 'current');
  const either = parse({ addressFormat: 'any' });
  assert.ok(either.ok);
  assert.equal(either.filters.addressFormat, 'any');
  // The recorded third format is a property's other address, not one of the two a search reads
  // through, and nothing else is a format at all.
  for (const value of ['alternate', 'Legacy', 'CURRENT', 'both'])
    assert.equal(parse({ addressFormat: value }).ok, false, value);
});

test('the creator selection is the one token, and nothing else', () => {
  assert.equal(parse({ createdBy: 'mine' }).ok, true);
  assert.equal(parse({ createdBy: '' }).ok, true);
  // It names no employee, so an identifier or any other word is refused rather than applied as a
  // different selection.
  for (const value of [
    '1',
    'Mine',
    '33333333-3333-4333-8333-333333333333',
    'not-mine',
  ])
    assert.equal(parse({ createdBy: value }).ok, false, value);
});

test('an unset or blank address value is no bound, not an invalid one', () => {
  for (const values of [{}, { status: '', priceMin: '  ' }]) {
    const result = parse(values);
    assert.ok(result.ok);
    assert.deepEqual(result.filters, noInventoryFilters);
  }
  // A padded value is the same value, so an address copied with stray spaces still filters.
  const padded = parse({ mode: ' both ', areaMax: ' 80.5 ' });
  assert.ok(padded.ok);
  assert.equal(padded.filters.mode, 'both');
  assert.equal(padded.filters.areaMax, '80.5');
});

test('unknown status, mode or type values are refused', () => {
  for (const values of [
    { status: 'archived' },
    { status: 'Available' },
    { mode: 'lease' },
    { mode: 'BOTH' },
    { type: 'shophouse' },
  ])
    assert.equal(parse(values).ok, false, JSON.stringify(values));
});

test('a price bound is whole VND across the database range', () => {
  for (const value of ['0', '123456789012345', '999999999999999999'])
    assert.equal(parse({ priceMin: value }).ok, true, value);
  for (const value of ['1.5', '-1', '1e9', '5 000', '1000000000000000000', ''])
    assert.equal(
      parse({ priceMin: value }).ok,
      value === '',
      `${value} price bound`,
    );
});

test('an area bound is positive square metres with at most two decimals', () => {
  for (const value of ['1', '45.5', '120.25', '9999999999.99'])
    assert.equal(parse({ areaMin: value }).ok, true, value);
  for (const value of ['0', '0.00', '-3', '12.345', '10000000000', 'abc'])
    assert.equal(parse({ areaMin: value }).ok, false, `${value} area bound`);
});

test('a reversed range and an equal bound', () => {
  assert.equal(
    parse({ priceMin: '9000', priceMax: '8000' }).ok,
    false,
    'reversed price range',
  );
  assert.equal(
    parse({ areaMin: '100.5', areaMax: '100.4' }).ok,
    false,
    'reversed area range',
  );
  for (const values of [
    { priceMin: '9000', priceMax: '9000' },
    { areaMin: '45.50', areaMax: '45.5' },
  ])
    assert.equal(parse(values).ok, true, JSON.stringify(values));
});

test('a bound size is compared exactly, never as a rounded number', () => {
  // Both bounds are far beyond exact float integers; only the larger one is a reversed range.
  assert.equal(
    parse({ priceMin: '999999999999999', priceMax: '999999999999998' }).ok,
    false,
  );
  assert.equal(
    parse({ areaMin: '9999999999.99', areaMax: '9999999999.98' }).ok,
    false,
  );
});

test('a province or ward value is an official unit identity', () => {
  const province = '11111111-1111-4111-8111-111111111111';
  const ward = '22222222-2222-4222-8222-222222222222';
  const provinceOnly = parse({ province });
  assert.ok(provinceOnly.ok);
  assert.equal(provinceOnly.filters.province, province);
  assert.equal(provinceOnly.filters.ward, null);
  const both = parse({ province, ward });
  assert.ok(both.ok);
  assert.equal(both.filters.province, province);
  assert.equal(both.filters.ward, ward);
});

test('a malformed unit and a ward without its province are refused', () => {
  for (const values of [
    { province: 'ho-chi-minh' },
    { province: '1111' },
    { ward: '22222222-2222-4222-8222-222222222222' },
    {
      province: '11111111-1111-4111-8111-111111111111',
      ward: 'ward-14',
    },
  ])
    assert.equal(parse(values).ok, false, JSON.stringify(values));
});

test('a contact value is a recorded identity, independent of the area filters', () => {
  const contact = '33333333-3333-4333-8333-333333333333';
  const result = parse({ contact });
  assert.ok(result.ok);
  assert.equal(result.filters.contact, contact);
  // The contact is its own condition: it needs no province or ward beside it.
  assert.equal(result.filters.province, null);
  assert.equal(result.filters.ward, null);
  // It composes with the other filters instead of replacing them.
  const composed = parse({ contact, status: 'available', areaMax: '80' });
  assert.ok(composed.ok);
  assert.deepEqual(filterParams(composed.filters), {
    status: 'available',
    addressFormat: 'legacy',
    areaMax: '80',
    contact,
  });
  assert.deepEqual(filterRpcArgs(composed.filters), {
    p_status: 'available',
    p_area_max: 80,
    p_address_format: 'legacy',
    p_contact_id: contact,
  });
  // A malformed identity is refused; a blank one is simply no filter.
  for (const value of [
    'not-a-contact',
    '33333333-3333-4333-8333',
    ' 40000000 ',
  ])
    assert.equal(parse({ contact: value }).ok, false, value);
  assert.equal(parse({ contact: '' }).ok, true);
});

test('only set filters become link and RPC parameters', () => {
  // The address format is one of the two formats rather than an absent value, so it is always
  // stated: it is the address the search reads through, and the default legacy search is itself a
  // narrowing. Every other filter appears only when the address sets it.
  assert.deepEqual(filterParams(noInventoryFilters), {
    addressFormat: 'legacy',
  });
  // The creator selection travels in the address like every other filter, so the link, the chip and
  // the control all read the one place a filter lives.
  assert.deepEqual(filterParams({ ...noInventoryFilters, createdBy: 'mine' }), {
    addressFormat: 'legacy',
    createdBy: 'mine',
  });
  assert.deepEqual(
    filterParams({ ...noInventoryFilters, mode: 'sale', areaMax: '80' }),
    { addressFormat: 'legacy', mode: 'sale', areaMax: '80' },
  );
  assert.equal(activeFilterCount(noInventoryFilters), 1);
  assert.equal(
    activeFilterCount({
      ...noInventoryFilters,
      status: 'available',
      mode: 'sale',
    }),
    3,
  );
  assert.deepEqual(filterRpcArgs(noInventoryFilters), {
    p_address_format: 'legacy',
  });
  // The creator selection names no parameter of this read: the whole-inventory search has no
  // creator criterion, and the selection is answered from the loaded catalogue alone.
  assert.deepEqual(
    filterRpcArgs({ ...noInventoryFilters, createdBy: 'mine' }),
    { p_address_format: 'legacy' },
  );
  assert.deepEqual(
    filterRpcArgs({
      ...noInventoryFilters,
      status: 'available',
      priceMin: '1000',
      priceMax: '2000',
      areaMin: '45.5',
    }),
    {
      p_status: 'available',
      p_price_min: '1000',
      p_price_max: '2000',
      p_area_min: 45.5,
      p_address_format: 'legacy',
    },
  );
  assert.deepEqual(
    filterRpcArgs({
      ...noInventoryFilters,
      priceMin: '100000000000000000',
      priceMax: '999999999999999999',
    }),
    {
      p_price_min: '100000000000000000',
      p_price_max: '999999999999999999',
      p_address_format: 'legacy',
    },
  );
  // The current format travels too, so the read is asked for the other recorded address.
  assert.deepEqual(
    filterRpcArgs({ ...noInventoryFilters, addressFormat: 'current' }),
    { p_address_format: 'current' },
  );
  // The choice that states no format is the read's own unconditional form: the address keeps the
  // choice, and the read is asked with no format parameter at all.
  assert.deepEqual(
    filterParams({ ...noInventoryFilters, addressFormat: 'any' }),
    { addressFormat: 'any' },
  );
  assert.deepEqual(
    filterRpcArgs({ ...noInventoryFilters, addressFormat: 'any' }),
    {},
  );
});

test('the narrower administrative unit is the read parameter', () => {
  const province = '11111111-1111-4111-8111-111111111111';
  const ward = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(filterParams({ ...noInventoryFilters, province, ward }), {
    addressFormat: 'legacy',
    province,
    ward,
  });
  assert.equal(activeFilterCount({ ...noInventoryFilters, province, ward }), 3);
  assert.deepEqual(filterRpcArgs({ ...noInventoryFilters, province }), {
    p_address_format: 'legacy',
    p_area_id: province,
  });
  // A ward is always inside its province, so the ward is the unit that governs.
  assert.deepEqual(filterRpcArgs({ ...noInventoryFilters, province, ward }), {
    p_address_format: 'legacy',
    p_area_id: ward,
  });
});

test('the catalog check refuses an absent or wrong-level unit', () => {
  const province = '11111111-1111-4111-8111-111111111111';
  const otherProvince = '44444444-4444-4444-8444-444444444444';
  const ward = '22222222-2222-4222-8222-222222222222';
  const absent = '33333333-3333-4333-8333-333333333333';
  const units = [
    { id: province, unit_level: 'province', parent_id: null },
    { id: otherProvince, unit_level: 'province', parent_id: null },
    { id: ward, unit_level: 'commune', parent_id: province },
  ];
  assert.equal(
    catalogUnitsMatch(units, { ...noInventoryFilters, province }),
    true,
  );
  assert.equal(
    catalogUnitsMatch(units, { ...noInventoryFilters, province, ward }),
    true,
  );
  assert.equal(catalogUnitsMatch([], noInventoryFilters), true);
  assert.equal(
    catalogUnitsMatch(units, { ...noInventoryFilters, province: ward }),
    false,
    'a ward value in the province slot',
  );
  assert.equal(
    catalogUnitsMatch(units, {
      ...noInventoryFilters,
      province,
      ward: province,
    }),
    false,
    'a province value in the ward slot',
  );
  assert.equal(
    catalogUnitsMatch(units, { ...noInventoryFilters, province: absent }),
    false,
    'an unknown province',
  );
  assert.equal(
    catalogUnitsMatch(units, {
      ...noInventoryFilters,
      province,
      ward: absent,
    }),
    false,
    'an unknown ward',
  );
  assert.equal(
    catalogUnitsMatch(units, {
      ...noInventoryFilters,
      province: otherProvince,
      ward,
    }),
    false,
    'a ward from a different province',
  );
});

test('the catalog check follows a legacy ward through its district', () => {
  const province = '11111111-1111-4111-8111-111111111111';
  const otherProvince = '44444444-4444-4444-8444-444444444444';
  const district = '55555555-5555-4555-8555-555555555555';
  const otherDistrict = '66666666-6666-4666-8666-666666666666';
  const ward = '22222222-2222-4222-8222-222222222222';
  const units = [
    { id: province, unit_level: 'province', parent_id: null },
    { id: otherProvince, unit_level: 'province', parent_id: null },
    { id: district, unit_level: 'district', parent_id: province },
    { id: otherDistrict, unit_level: 'district', parent_id: otherProvince },
    { id: ward, unit_level: 'commune', parent_id: district },
  ];
  assert.equal(
    catalogUnitsMatch(units, { ...noInventoryFilters, province, ward }),
    true,
    'the legacy ward, its district and the legacy province the district names',
  );
  assert.equal(
    catalogUnitsMatch(units, { ...noInventoryFilters, province }),
    true,
    'the legacy province alone',
  );
  assert.equal(
    catalogUnitsMatch(units, {
      ...noInventoryFilters,
      province: otherProvince,
      ward,
    }),
    false,
    'a legacy ward under a district of a different legacy province',
  );
  assert.equal(
    catalogUnitsMatch(units, { ...noInventoryFilters, province: district }),
    false,
    'a district value in the province slot',
  );
  assert.equal(
    catalogUnitsMatch(
      units.filter((unit) => unit.id !== district),
      {
        ...noInventoryFilters,
        province,
        ward,
      },
    ),
    false,
    'a legacy ward whose district was not read',
  );
});
