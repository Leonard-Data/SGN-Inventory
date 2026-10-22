import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeFilterCount,
  catalogUnitsMatch,
  filterParams,
  filterRpcArgs,
  INVENTORY_ACCESS_TYPES,
  INVENTORY_ADDRESS_FORMAT_ANY,
  INVENTORY_ADDRESS_FORMATS,
  noInventoryFilters,
  offeredAddressLevels,
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
    accessType: 'car_alley',
    addressFormat: 'current',
    priceMin: '5000000',
    priceMax: '25000000',
    areaMin: '45.5',
    areaMax: '120',
    frontageMin: '4.5',
    frontageMax: '12',
    depthMin: '16',
    depthMax: '30.25',
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
    accessType: 'car_alley',
    addressFormat: 'current',
    priceMin: '5000000',
    priceMax: '25000000',
    areaMin: '45.5',
    areaMax: '120',
    frontageMin: '4.5',
    frontageMax: '12',
    depthMin: '16',
    depthMax: '30.25',
    province: '11111111-1111-4111-8111-111111111111',
    district: null,
    ward: '22222222-2222-4222-8222-222222222222',
    contact: '33333333-3333-4333-8333-333333333333',
    createdBy: 'mine',
  });
  // The address this set produces reads back as the same set, so every stated bound survives a
  // reload instead of being reopened empty.
  const reloaded = parseInventoryFilters(
    new URLSearchParams(filterParams(result.filters)),
  );
  assert.ok(reloaded.ok);
  assert.deepEqual(reloaded.filters, result.filters);
});

// The panel offers exactly the two formats a search is matched through and opens on the legacy one;
// the cleared state that applies no format condition is carried by the address alone.
test('the address format offers two formats and a cleared state the address carries', () => {
  assert.deepEqual([...INVENTORY_ADDRESS_FORMATS], ['legacy', 'current']);
  const unstated = parse({});
  assert.ok(unstated.ok);
  assert.equal(unstated.filters.addressFormat, 'legacy');
  assert.equal(parse({ addressFormat: 'legacy' }).ok, true);
  const current = parse({ addressFormat: 'current' });
  assert.ok(current.ok);
  assert.equal(current.filters.addressFormat, 'current');
  const cleared = parse({ addressFormat: 'any' });
  assert.ok(cleared.ok);
  assert.equal(cleared.filters.addressFormat, 'any');
  // Clearing the format filter states the cleared search in the address, so a reload reads it back
  // instead of reopening the default legacy search.
  const clearedAddress = filterParams({
    ...noInventoryFilters,
    addressFormat: 'any',
  });
  assert.deepEqual(clearedAddress, { addressFormat: 'any' });
  const reloaded = parseInventoryFilters(new URLSearchParams(clearedAddress));
  assert.ok(reloaded.ok);
  assert.equal(reloaded.filters.addressFormat, 'any');
  // The recorded third format is a property's other address, not one of the two a search reads
  // through, and nothing else is a format at all.
  for (const value of ['alternate', 'Legacy', 'CURRENT', 'both'])
    assert.equal(parse({ addressFormat: value }).ok, false, value);
});

// The panel keeps every control of the chosen format in place from the moment it opens, so the
// dependent ones are visible and only wait for the level above them to be chosen.
test('the panel offers every level of the chosen address format at once', () => {
  assert.deepEqual(
    [...offeredAddressLevels('legacy')],
    ['province', 'district', 'ward'],
  );
  assert.deepEqual([...offeredAddressLevels('current')], ['province', 'ward']);
  assert.deepEqual(
    [...offeredAddressLevels(INVENTORY_ADDRESS_FORMAT_ANY)],
    ['province', 'district', 'ward'],
  );
});

// The whole-inventory read takes its criteria as optional parameters, so a caller that states no
// format asks for no format condition rather than for the page's default legacy search.
test('an absent format parameter is no format condition for the read', () => {
  const read = parseInventoryFilters(
    new URLSearchParams(),
    INVENTORY_ADDRESS_FORMAT_ANY,
  );
  assert.ok(read.ok);
  assert.equal(read.filters.addressFormat, 'any');
  assert.deepEqual(filterRpcArgs(read.filters), {});
  // The page's own address keeps its default: the search opens on the legacy address.
  const page = parse({});
  assert.ok(page.ok);
  assert.equal(page.filters.addressFormat, 'legacy');
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

test('an access type is one of the five recorded states, and nothing else', () => {
  assert.deepEqual(
    [...INVENTORY_ACCESS_TYPES],
    [
      'unknown',
      'street_front',
      'car_alley',
      'motorbike_alley',
      'three_wheeler_alley',
    ],
  );
  // The "not known" state is a recorded value to filter by, not the cleared filter.
  for (const value of INVENTORY_ACCESS_TYPES) {
    const result = parse({ accessType: value });
    assert.ok(result.ok, value);
    assert.equal(result.filters.accessType, value);
    assert.equal(result.filters.status, null);
  }
  const carAlley = parse({ accessType: 'car_alley' });
  assert.ok(carAlley.ok);
  assert.deepEqual(filterParams(carAlley.filters), {
    addressFormat: 'legacy',
    accessType: 'car_alley',
  });
  assert.deepEqual(filterRpcArgs(carAlley.filters), {
    p_address_format: 'legacy',
    p_access_type: 'car_alley',
  });
  // A re-spelling, an unknown word or the cleared state is refused rather than applied as a filter
  // that matches nothing; a blank value is simply no access condition.
  for (const value of ['car', 'Car_Alley', 'CAR_ALLEY', 'street', 'any'])
    assert.equal(parse({ accessType: value }).ok, false, value);
  assert.equal(parse({ accessType: '' }).ok, true);
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

test('a dimension bound is positive metres under the area bound’s own rule', () => {
  for (const key of [
    'frontageMin',
    'frontageMax',
    'depthMin',
    'depthMax',
  ] as const) {
    for (const value of ['1', '4.5', '120.25', '9999999999.99'])
      assert.equal(parse({ [key]: value }).ok, true, `${key} ${value}`);
    for (const value of ['0', '0.00', '-3', '12.345', '10000000000', 'abc'])
      assert.equal(parse({ [key]: value }).ok, false, `${key} ${value}`);
  }
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
  // Each dimension's range is refused on its own, so a stated minimum above its maximum never
  // becomes an inventory that matches nothing.
  assert.equal(
    parse({ frontageMin: '12', frontageMax: '4.5' }).ok,
    false,
    'reversed frontage range',
  );
  assert.equal(
    parse({ depthMin: '30.25', depthMax: '16' }).ok,
    false,
    'reversed depth range',
  );
  // One reversed range refuses the whole set, and a sound pair beside it does not excuse it.
  assert.equal(
    parse({
      frontageMin: '4.5',
      frontageMax: '12',
      depthMin: '30',
      depthMax: '16',
    }).ok,
    false,
    'one reversed dimension range',
  );
  for (const values of [
    { priceMin: '9000', priceMax: '9000' },
    { areaMin: '45.50', areaMax: '45.5' },
    { frontageMin: '4.50', frontageMax: '4.5' },
    { depthMin: '16', depthMax: '16.00' },
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
  assert.equal(
    parse({ frontageMin: '9999999999.99', frontageMax: '9999999999.98' }).ok,
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
  // Each dimension bound is its own address parameter, so the bounds round-trip through the link.
  assert.deepEqual(
    filterParams({
      ...noInventoryFilters,
      frontageMin: '4.5',
      depthMax: '30',
    }),
    { addressFormat: 'legacy', frontageMin: '4.5', depthMax: '30' },
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
      frontageMax: '12',
      depthMin: '16',
    }),
    {
      p_status: 'available',
      p_price_min: '1000',
      p_price_max: '2000',
      p_area_min: 45.5,
      p_frontage_max: 12,
      p_depth_min: 16,
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

test('each stated administrative level is its own read parameter', () => {
  const province = '11111111-1111-4111-8111-111111111111';
  const district = '55555555-5555-4555-8555-555555555555';
  const ward = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(
    filterParams({ ...noInventoryFilters, province, district, ward }),
    { addressFormat: 'legacy', province, district, ward },
  );
  assert.equal(
    activeFilterCount({ ...noInventoryFilters, province, district, ward }),
    4,
  );
  // A legacy province offers all three levels beneath it, so a province alone is one level stated.
  assert.deepEqual(filterRpcArgs({ ...noInventoryFilters, province }), {
    p_address_format: 'legacy',
    p_province_id: province,
  });
  // The levels compose on one address rather than the narrower unit replacing those above it, so
  // every stated level travels.
  assert.deepEqual(
    filterRpcArgs({ ...noInventoryFilters, province, district }),
    {
      p_address_format: 'legacy',
      p_province_id: province,
      p_district_id: district,
    },
  );
  assert.deepEqual(
    filterRpcArgs({ ...noInventoryFilters, province, district, ward }),
    {
      p_address_format: 'legacy',
      p_province_id: province,
      p_district_id: district,
      p_commune_id: ward,
    },
  );
  // A current address has no district level, so its ward is the level beneath the province.
  assert.deepEqual(
    filterRpcArgs({
      ...noInventoryFilters,
      addressFormat: 'current',
      province,
      ward,
    }),
    {
      p_address_format: 'current',
      p_province_id: province,
      p_commune_id: ward,
    },
  );
});

test('a district is a legacy-level unit of an address filter set', () => {
  const province = '11111111-1111-4111-8111-111111111111';
  const district = '55555555-5555-4555-8555-555555555555';
  const stated = parse({ province, district });
  assert.ok(stated.ok);
  assert.equal(stated.filters.district, district);
  // The district and the ward each narrow the province, so neither stands without it.
  for (const values of [{ district }, { district: 'quan-1' }])
    assert.equal(parse(values).ok, false, JSON.stringify(values));
  // The two-tier current generation records no district, so a current-address search that states
  // one is refused rather than read as a filter that matches nothing.
  assert.equal(
    parse({ addressFormat: 'current', province, district }).ok,
    false,
  );
  // The cleared format states no format condition, so a district still applies to the addresses
  // that record it.
  assert.equal(parse({ addressFormat: 'any', province, district }).ok, true);
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
  // A stated district is a level of its own: inside the stated province, and the ward's own parent.
  assert.equal(
    catalogUnitsMatch(units, { ...noInventoryFilters, province, district }),
    true,
    'the district inside its province',
  );
  assert.equal(
    catalogUnitsMatch(units, {
      ...noInventoryFilters,
      province: otherProvince,
      district,
    }),
    false,
    'a district from a different province',
  );
  assert.equal(
    catalogUnitsMatch(units, {
      ...noInventoryFilters,
      province,
      district: ward,
    }),
    false,
    'a ward value in the district slot',
  );
  assert.equal(
    catalogUnitsMatch(units, {
      ...noInventoryFilters,
      province,
      district: otherDistrict,
    }),
    false,
    'a district of another province',
  );
  assert.equal(
    catalogUnitsMatch(units, {
      ...noInventoryFilters,
      province,
      district,
      ward,
    }),
    true,
    'the legacy province, district and ward together',
  );
  assert.equal(
    catalogUnitsMatch(units, {
      ...noInventoryFilters,
      province,
      district: otherDistrict,
      ward,
    }),
    false,
    'a ward outside the stated district',
  );
});
