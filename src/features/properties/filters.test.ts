import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeFilterCount,
  catalogUnitsMatch,
  communeIds,
  communeValue,
  filterParams,
  filterRpcArgs,
  INVENTORY_ACCESS_TYPES,
  INVENTORY_ADDRESS_FORMAT_ANY,
  INVENTORY_ADDRESS_FORMATS,
  noInventoryFilters,
  offeredAddressLevels,
  parseInventoryFilters,
  withoutCommune,
} from './filters.ts';
import { FIXED_PROVINCE } from '../property-maintenance/units.ts';

// The official code of the one province the app records, the identity its catalog rows share across
// generations.
const PROVINCE_CODE = '79';

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
    province: FIXED_PROVINCE.id,
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
    // The stated province is not a condition: the app records one province.
    province: null,
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
// dependent ones are visible and only wait for the level above them to be chosen. No level of the
// panel is a province: the app states the one province it records and every list narrows inside it.
test('the panel offers the levels beneath the stated province and never a province picker', () => {
  assert.deepEqual([...offeredAddressLevels('legacy')], ['district', 'ward']);
  assert.deepEqual([...offeredAddressLevels('current')], ['ward']);
  assert.deepEqual(
    [...offeredAddressLevels(INVENTORY_ADDRESS_FORMAT_ANY)],
    ['district', 'ward'],
  );
  for (const format of ['legacy', 'current', INVENTORY_ADDRESS_FORMAT_ANY])
    assert.equal(
      (offeredAddressLevels(format) as readonly string[]).includes('province'),
      false,
      format,
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

test('a stated province is the one the app records, and a ward is an official unit identity', () => {
  const ward = '22222222-2222-4222-8222-222222222222';
  // A link that still carries the province keeps working: the stated province is accepted and adds
  // no condition, because the app records that one province.
  const provinceOnly = parse({ province: FIXED_PROVINCE.id });
  assert.ok(provinceOnly.ok);
  assert.equal(provinceOnly.filters.province, null);
  assert.equal(provinceOnly.filters.ward, null);
  const both = parse({ province: FIXED_PROVINCE.id, ward });
  assert.ok(both.ok);
  assert.equal(both.filters.province, null);
  assert.equal(both.filters.ward, ward);
  // A link naming another province is refused rather than silently read as this province's filter.
  assert.equal(
    parse({ province: '11111111-1111-4111-8111-111111111111' }).ok,
    false,
  );
});

test('a malformed unit is refused and a ward stands without a province', () => {
  const ward = '22222222-2222-4222-8222-222222222222';
  for (const values of [
    { province: 'ho-chi-minh' },
    { province: '1111' },
    { province: FIXED_PROVINCE.id, ward: 'ward-14' },
    { district: 'quan-1' },
  ])
    assert.equal(parse(values).ok, false, JSON.stringify(values));
  // The province is stated by the app, so a ward or district needs no province beside it.
  assert.equal(parse({ ward }).ok, true);
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

test('each stated level beneath the province is its own read parameter', () => {
  const district = '55555555-5555-4555-8555-555555555555';
  const ward = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(filterParams({ ...noInventoryFilters, district, ward }), {
    addressFormat: 'legacy',
    district,
    ward,
  });
  assert.equal(activeFilterCount({ ...noInventoryFilters, district, ward }), 3);
  // No province travels: the app records one province, so the district and the ward are the levels
  // a person states.
  assert.deepEqual(filterRpcArgs({ ...noInventoryFilters, district }), {
    p_address_format: 'legacy',
    p_district_id: district,
  });
  // The levels compose on one address rather than the narrower unit replacing those above it, so
  // every stated level travels.
  assert.deepEqual(filterRpcArgs({ ...noInventoryFilters, district, ward }), {
    p_address_format: 'legacy',
    p_district_id: district,
    p_commune_ids: [ward],
  });
  // A current address has no district level, so its ward is the only level beneath the province.
  assert.deepEqual(
    filterRpcArgs({
      ...noInventoryFilters,
      addressFormat: 'current',
      ward,
    }),
    {
      p_address_format: 'current',
      p_commune_ids: [ward],
    },
  );
});

test('the commune filter carries a set, and one selection reads as it always did', () => {
  const first = '22222222-2222-4222-8222-222222222222';
  const second = '88888888-8888-4888-8888-888888888888';
  // One commune is the one-element set, stated in the address exactly as it always was, so an
  // existing link reads back unchanged.
  const single = parse({ ward: first });
  assert.ok(single.ok);
  assert.equal(single.filters.ward, first);
  assert.deepEqual(communeIds(single.filters.ward), [first]);
  assert.deepEqual(filterRpcArgs(single.filters), {
    p_address_format: 'legacy',
    p_commune_ids: [first],
  });
  // Several communes travel as the set they are, in the order they were chosen, so one read
  // answers the union of what each commune would answer alone.
  const stated = parse({ ward: `${first},${second}` });
  assert.ok(stated.ok);
  assert.deepEqual(communeIds(stated.filters.ward), [first, second]);
  assert.deepEqual(filterRpcArgs(stated.filters), {
    p_address_format: 'legacy',
    p_commune_ids: [first, second],
  });
  // The set round-trips through the address, so a reload or a return from a property reads the same
  // communes back.
  assert.deepEqual(filterParams(stated.filters), {
    addressFormat: 'legacy',
    ward: `${first},${second}`,
  });
  assert.equal(communeValue([first, second]), `${first},${second}`);
  assert.equal(communeValue([]), null);
  const reloaded = parseInventoryFilters(
    new URLSearchParams(filterParams(stated.filters)),
  );
  assert.ok(reloaded.ok);
  assert.deepEqual(reloaded.filters, stated.filters);
  // Removing one commune narrows the set to the others, and removing the last one clears the
  // criterion altogether.
  assert.equal(withoutCommune(stated.filters, first).ward, second);
  assert.equal(withoutCommune(stated.filters, second).ward, first);
  assert.equal(withoutCommune(single.filters, first).ward, null);
  assert.deepEqual(filterParams(withoutCommune(single.filters, first)), {
    addressFormat: 'legacy',
  });
});

test('a malformed, empty or duplicated commune is refused rather than dropped', () => {
  const first = '22222222-2222-4222-8222-222222222222';
  const second = '88888888-8888-4888-8888-888888888888';
  for (const ward of [
    `${first},`,
    `,${first}`,
    `${first},,${second}`,
    // A commune stated twice is refused rather than read as the set minus the repeat.
    `${first},${first}`,
    `${first},ward-14`,
    `${first},ho-chi-minh`,
  ])
    assert.equal(parse({ ward }).ok, false, ward);
});

test('a district is a legacy-level unit of an address filter set', () => {
  const district = '55555555-5555-4555-8555-555555555555';
  const stated = parse({ province: FIXED_PROVINCE.id, district });
  assert.ok(stated.ok);
  assert.equal(stated.filters.district, district);
  // The province is stated by the app, so a district stands without one and keeps its own shape.
  assert.equal(parse({ district }).ok, true);
  assert.equal(parse({ district: 'quan-1' }).ok, false);
  // The two-tier current generation records no district, so a current-address search that states
  // one is refused rather than read as a filter that matches nothing.
  assert.equal(parse({ addressFormat: 'current', district }).ok, false);
  // The cleared format states no format condition, so a district still applies to the addresses
  // that record it.
  assert.equal(parse({ addressFormat: 'any', district }).ok, true);
});

test('the catalog check refuses an absent or wrong-level unit', () => {
  const otherProvince = '44444444-4444-4444-8444-444444444444';
  const ward = '22222222-2222-4222-8222-222222222222';
  const secondWard = '99999999-9999-4999-8999-999999999999';
  const absent = '33333333-3333-4333-8333-333333333333';
  // The province is one official unit with a row per catalog generation, so the lineage is matched
  // by its official code: the stated province's own row carries it.
  const units = [
    {
      id: FIXED_PROVINCE.id,
      unit_level: 'province',
      parent_id: null,
      official_code: PROVINCE_CODE,
    },
    {
      id: otherProvince,
      unit_level: 'province',
      parent_id: null,
      official_code: '01',
    },
    {
      id: ward,
      unit_level: 'commune',
      parent_id: FIXED_PROVINCE.id,
      official_code: '26734',
    },
    {
      id: secondWard,
      unit_level: 'commune',
      parent_id: FIXED_PROVINCE.id,
      official_code: '26735',
    },
  ];
  assert.equal(
    catalogUnitsMatch(units, noInventoryFilters, PROVINCE_CODE),
    true,
  );
  assert.equal(
    catalogUnitsMatch(units, { ...noInventoryFilters, ward }, PROVINCE_CODE),
    true,
  );
  assert.equal(catalogUnitsMatch([], noInventoryFilters, PROVINCE_CODE), true);
  assert.equal(
    catalogUnitsMatch(
      units,
      { ...noInventoryFilters, district: ward },
      PROVINCE_CODE,
    ),
    false,
    'a ward value in the district slot',
  );
  assert.equal(
    catalogUnitsMatch(
      units,
      { ...noInventoryFilters, ward: FIXED_PROVINCE.id },
      PROVINCE_CODE,
    ),
    false,
    'a province value in the ward slot',
  );
  assert.equal(
    catalogUnitsMatch(
      units,
      { ...noInventoryFilters, ward: absent },
      PROVINCE_CODE,
    ),
    false,
    'an unknown ward',
  );
  assert.equal(
    catalogUnitsMatch(
      units,
      { ...noInventoryFilters, ward: `${ward},${secondWard}` },
      PROVINCE_CODE,
    ),
    true,
    'a set of communes of the stated province',
  );
  // A set is only as good as every commune in it: one absent commune refuses the whole set rather
  // than being dropped and the rest applied.
  assert.equal(
    catalogUnitsMatch(
      units,
      { ...noInventoryFilters, ward: `${ward},${absent}` },
      PROVINCE_CODE,
    ),
    false,
    'an unknown commune in the set',
  );
  // A ward of another province is not inside the province the app records.
  assert.equal(
    catalogUnitsMatch(
      units.map((unit) =>
        unit.id === ward ? { ...unit, parent_id: otherProvince } : unit,
      ),
      { ...noInventoryFilters, ward },
      PROVINCE_CODE,
    ),
    false,
    'a ward from another province',
  );
  // Another official unit's row is not the stated province, however it is identified.
  assert.equal(
    catalogUnitsMatch(
      units.map((unit) =>
        unit.id === FIXED_PROVINCE.id ? { ...unit, official_code: '01' } : unit,
      ),
      { ...noInventoryFilters, ward },
      PROVINCE_CODE,
    ),
    false,
    'a province row of another official unit',
  );
});

test('the catalog check follows a legacy ward through its district', () => {
  const otherProvince = '44444444-4444-4444-8444-444444444444';
  const legacyProvince = '77777777-7777-4777-8777-777777777777';
  const district = '55555555-5555-4555-8555-555555555555';
  const otherDistrict = '66666666-6666-4666-8666-666666666666';
  const ward = '22222222-2222-4222-8222-222222222222';
  // A legacy address records the pre-2025 row of the stated province, so its district hangs off that
  // row rather than the current one the app states: both rows are one official unit.
  const units = [
    {
      id: FIXED_PROVINCE.id,
      unit_level: 'province',
      parent_id: null,
      official_code: PROVINCE_CODE,
    },
    {
      id: legacyProvince,
      unit_level: 'province',
      parent_id: null,
      official_code: PROVINCE_CODE,
    },
    {
      id: otherProvince,
      unit_level: 'province',
      parent_id: null,
      official_code: '01',
    },
    {
      id: district,
      unit_level: 'district',
      parent_id: legacyProvince,
      official_code: '760',
    },
    {
      id: otherDistrict,
      unit_level: 'district',
      parent_id: otherProvince,
      official_code: '001',
    },
    {
      id: ward,
      unit_level: 'commune',
      parent_id: district,
      official_code: '26734',
    },
  ];
  assert.equal(
    catalogUnitsMatch(units, { ...noInventoryFilters, ward }, PROVINCE_CODE),
    true,
    'the legacy ward, its district and the legacy row of the stated province',
  );
  assert.equal(
    catalogUnitsMatch(
      units.filter((unit) => unit.id !== district),
      { ...noInventoryFilters, ward },
      PROVINCE_CODE,
    ),
    false,
    'a legacy ward whose district was not read',
  );
  // A stated district is a level of its own: inside the stated province, and the ward's own parent.
  assert.equal(
    catalogUnitsMatch(
      units,
      { ...noInventoryFilters, district },
      PROVINCE_CODE,
    ),
    true,
    'the district inside its province',
  );
  assert.equal(
    catalogUnitsMatch(
      units,
      { ...noInventoryFilters, district: ward },
      PROVINCE_CODE,
    ),
    false,
    'a ward value in the district slot',
  );
  assert.equal(
    catalogUnitsMatch(
      units,
      { ...noInventoryFilters, district: otherDistrict },
      PROVINCE_CODE,
    ),
    false,
    'a district of another province',
  );
  assert.equal(
    catalogUnitsMatch(
      units,
      { ...noInventoryFilters, district, ward },
      PROVINCE_CODE,
    ),
    true,
    'the stated province, district and ward together',
  );
  assert.equal(
    catalogUnitsMatch(
      units,
      { ...noInventoryFilters, district: otherDistrict, ward },
      PROVINCE_CODE,
    ),
    false,
    'a ward outside the stated district',
  );
});
