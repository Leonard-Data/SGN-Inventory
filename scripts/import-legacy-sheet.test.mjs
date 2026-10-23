import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PRICE_CEILING_VND,
  adminNameKey,
  buildReference,
  classifyChildReference,
  classifyProjectType,
  columnReport,
  confirmationProblems,
  contactKey,
  contactSummary,
  credentialColumns,
  invitationSummary,
  isPlaceholderOwner,
  listingModeFromLabel,
  mapMasterRow,
  parseArea,
  parseAreaPair,
  parseMeasure,
  parseMoneyVnd,
  parsePhones,
  parseSourceDate,
  readSpreadsheet,
  recordBucket,
  importablePropertyKeys,
  renderReport,
  resolveAddress,
  rosterEmployees,
  statusFromLabel,
  statusQuarantine,
  writeOutcome,
  vietMapBoundaryTarget,
} from './import-legacy-sheet.mjs';
import {
  assertWriteTarget,
  convertedSkipped,
  currentAddressText,
  declaredStage,
  invitationOrigin,
  invitationRecipients,
  recordedInvitations,
  importableBucket,
  planAttachmentImport,
  planStaffAccounts,
  PRODUCTION_PROJECT_REF,
  PRODUCTION_R2_BUCKET,
  PRODUCTION_R2_ACCOUNT_ID,
  PRODUCTION_APP_URL,
  sendInvitations,
  staffRoleFor,
} from './legacy-import-write.mjs';

const BILLION = 1000000000;

test('an imported current address reads house number, street, commune and province', () => {
  assert.equal(
    currentAddressText(
      { house_number: '12', street: 'Lý Thường Kiệt' },
      { name: 'Phường Bến Nghé', provinceName: 'Thành phố Hồ Chí Minh' },
    ),
    '12 Lý Thường Kiệt, Phường Bến Nghé, Thành phố Hồ Chí Minh',
  );
  assert.equal(
    currentAddressText(
      { house_number: null, street: 'Lý Thường Kiệt' },
      { name: 'Phường Bến Nghé', provinceName: 'Thành phố Hồ Chí Minh' },
    ),
    'Lý Thường Kiệt, Phường Bến Nghé, Thành phố Hồ Chí Minh',
  );
});

test('billions and millions of dong become whole VND without floating point', () => {
  assert.equal(parseMoneyVnd('23,00', BILLION).value, '23000000000');
  assert.equal(parseMoneyVnd('22.5', BILLION).value, '22500000000');
  assert.equal(parseMoneyVnd('0', BILLION).value, '0');
  assert.equal(parseMoneyVnd('', BILLION).value, null);
  assert.equal(parseMoneyVnd('15', 1000000).value, '15000000');
  // A mixed separator is ambiguous: the source could mean 1234 or 1.234.
  assert.equal(parseMoneyVnd('1.234,5', BILLION).error, 'ambiguous_number');
  assert.equal(parseMoneyVnd('-1', BILLION).error, 'negative_money');
  assert.equal(parseMoneyVnd('1000000000', BILLION).error, 'money_overflow');
  // A source figure finer than one dong cannot become whole VND.
  assert.equal(parseMoneyVnd('0.0000000001', BILLION).error, 'fractional_vnd');
});

test('the captain ceiling is 200 billion dong', () => {
  assert.equal(PRICE_CEILING_VND, 200000000000n);
});

test('measurements stay positive decimals and areas need an explicit unit', () => {
  assert.equal(parseArea('64m2 (4m x16m)').value, '64');
  assert.equal(parseArea('47,4m²').value, '47.4');
  assert.equal(parseArea('64').error, 'area_without_unit');
  assert.equal(parseArea('0m2').error, 'non_positive');
  assert.equal(parseArea('').value, null);
  // A value the column cannot store is a read error, so it never reaches the insert.
  assert.equal(parseMeasure('1234567', 2, 999999.99).error, 'measure_overflow');
  assert.equal(parseMeasure('999999.99', 2, 999999.99).value, '999999.99');
  assert.equal(
    parseArea('99999999999999m2', 9999999999.99).error,
    'measure_overflow',
  );
});

test('the pair an area text carries keeps the decimals the dimension columns rounded', () => {
  assert.deepEqual(parseAreaPair('80m2 (4,5m x16m)', 999999.99), {
    frontage_m: '4.5',
    depth_m: '16',
  });
  // No pair, a zero pair and a pair the column cannot hold are all simply no pair.
  assert.deepEqual(parseAreaPair('47,4m²', 999999.99), {
    frontage_m: null,
    depth_m: null,
  });
  assert.deepEqual(parseAreaPair('0m2 (0m x0m)', 999999.99), {
    frontage_m: null,
    depth_m: null,
  });
  assert.deepEqual(parseAreaPair('64m2 (4,555m x16m)', 999999.99), {
    frontage_m: null,
    depth_m: null,
  });
  assert.deepEqual(parseAreaPair('', 999999.99), {
    frontage_m: null,
    depth_m: null,
  });
});

test('the area text pair outranks the rounded dimension columns', () => {
  const headers = ['Tổng diện tích', 'Chiều ngang', 'Chiều dài'];
  const index = Object.fromEntries(
    headers.map((header, position) => [header, position]),
  );
  const reference = buildReference({});

  const rounded = mapMasterRow(
    ['80m2 (4,5m x16m)', '5', '16'],
    index,
    reference,
    '2026-10-18',
  );
  assert.equal(rounded.mapped.property.frontage_m, '4.5');
  assert.equal(rounded.mapped.property.depth_m, '16');
  assert.equal(rounded.mapped.property.land_area_m2, '80');
  assert.ok(rounded.issues.includes('frontage_m:area_text_conflict'));
  assert.ok(!rounded.issues.includes('depth_m:area_text_conflict'));

  // Without a pair the columns still decide, and an empty column is filled rather than reported.
  const columnsOnly = mapMasterRow(
    ['47,4m²', '5', '9'],
    index,
    reference,
    '2026-10-18',
  );
  assert.equal(columnsOnly.mapped.property.frontage_m, '5');
  assert.equal(columnsOnly.mapped.property.depth_m, '9');
  assert.ok(
    !columnsOnly.issues.some((issue) => issue.endsWith('area_text_conflict')),
  );

  const emptyColumn = mapMasterRow(
    ['80m2 (4,5m x16m)', '', '16'],
    index,
    reference,
    '2026-10-18',
  );
  assert.equal(emptyColumn.mapped.property.frontage_m, '4.5');
  assert.ok(
    !emptyColumn.issues.some((issue) => issue.endsWith('area_text_conflict')),
  );

  // A column value the parser rejects stays rejected: the pair never rescues it.
  const rejected = mapMasterRow(
    ['80m2 (4,5m x16m)', '-5', '16'],
    index,
    reference,
    '2026-10-18',
  );
  assert.equal(rejected.mapped.property.frontage_m, null);
  assert.ok(rejected.issues.includes('frontage_m:negative_measure'));
});

test('phone values are normalised only when they are recognisable mobiles', () => {
  const both = parsePhones('0906470481 - 0933677654');
  assert.deepEqual(both.phones, ['+84906470481', '+84933677654']);
  assert.equal(both.needsReview, 0);
  assert.equal(both.raw, '0906470481 - 0933677654');
  // A landline is preserved as text for review, not forced into the mobile shape.
  assert.deepEqual(parsePhones('02838221234').phones, []);
  assert.equal(parsePhones('02838221234').needsReview, 1);
  assert.deepEqual(parsePhones('0').phones, []);
  assert.equal(parsePhones('0').needsReview, 1);
  assert.deepEqual(parsePhones('+84906470481').phones, ['+84906470481']);
});

test('source dates are read as day-first unless the day field proves otherwise', () => {
  assert.equal(parseSourceDate('24/03/2024').value, '2024-03-24');
  assert.equal(parseSourceDate('8/16/24').value, '2024-08-16');
  assert.equal(parseSourceDate('31/02/2024').error, 'invalid_date');
  assert.equal(parseSourceDate('').value, null);
});

test('ward numbers normalise but districts never collide', () => {
  assert.equal(adminNameKey('Phường 01'), adminNameKey('phường 1'));
  assert.equal(adminNameKey('Phường 01'), adminNameKey('Phuong 1'));
  assert.notEqual(adminNameKey('Quận 1'), adminNameKey('Quận 10'));
  assert.equal(adminNameKey('Thành phố Thủ Đức'), adminNameKey('Quận Thủ Đức'));
  assert.equal(adminNameKey('Xã Bình Hưng'), adminNameKey('Bình Hưng'));
});

test('reference labels carry the meaning: type, mode and state', () => {
  assert.equal(listingModeFromLabel('Nhà đất bán').value, 'sale');
  assert.equal(listingModeFromLabel('Nhà đất cho thuê').value, 'rent');
  assert.equal(listingModeFromLabel('').error, 'missing');
  assert.equal(statusFromLabel('Đang giao dịch'), 'negotiating');
  assert.equal(statusFromLabel('Đang Thương lượng'), 'negotiating');
  assert.equal(statusFromLabel('Tạo mới'), 'draft');
  assert.equal(statusFromLabel('bogus'), null);
  assert.equal(classifyProjectType('Mặt tiền').access_type, 'street_front');
  assert.equal(classifyProjectType('Hẻm ô tô').access_type, 'car_alley');
  assert.equal(classifyProjectType('Nhà nát').property_type, 'house');
  assert.equal(classifyProjectType('Vila/ Biệt thự').property_type, 'villa');
  assert.equal(classifyProjectType('Kho xưởng').known, false);
});

test('a contact is one distinct owner name plus phone set', () => {
  const first = {
    display_name: 'Cô Kim',
    phones: ['+84902467845', '+84347012280'],
    raw_phone_text: '0902467845 - 0347012280',
  };
  const reordered = {
    display_name: ' cô kim ',
    phones: ['+84347012280', '+84902467845'],
    raw_phone_text: '0347012280/0902467845',
  };
  const otherPerson = {
    display_name: 'Cô Kim',
    phones: ['+84902467845'],
    raw_phone_text: '',
  };
  assert.equal(contactKey(first), contactKey(reordered));
  assert.notEqual(contactKey(first), contactKey(otherPerson));
});

test('every master column is mapped or named, so none is dropped silently', () => {
  // Headers exactly as the live master tab spells them, typos included.
  const headers = [
    'PropertyID',
    'Tên người tạo',
    'Email Người Tạo',
    'Ngày Tạo',
    'Tên chủ sở hũu',
    'Số điện thoai',
    'Địa chỉ dự án',
    'Chiều ngang',
    'Chiều dài',
    'Tổng diện tích',
    'Loại Hình',
    'Loại Dự án',
    'Tạo mới',
    'Hướng nhà',
    'Ghi Chú Thêm',
    'Giá Bán (tỷ Đồng)',
    'Giá Thuê (triệu Đồng)',
    'Thành phố',
    'Quận',
    'Phường',
    'Tên Đường',
    'Địa Chỉ',
    'Ngày Chỉnh Sửa gần nhất',
    'Note',
    'Temp Value',
    'Người chỉnh sửa',
    'Kết cấu',
    'Approved',
  ];
  const report = columnReport(headers);
  assert.equal(report.length, headers.length);
  assert.deepEqual(
    report.filter((entry) => entry.state === 'mapped').length,
    21,
  );
  const named = report
    .filter((entry) => entry.state !== 'mapped')
    .map((entry) => entry.column);
  assert.deepEqual(named, [
    'Tên người tạo',
    'Email Người Tạo',
    'Ngày Chỉnh Sửa gần nhất',
    'Note',
    'Temp Value',
    'Người chỉnh sửa',
    'Approved',
  ]);
  assert.deepEqual(columnReport(['Surprise'])[0].state, 'unmapped');
});

test('a write run resolves the creator and editor columns it would otherwise call blocked', () => {
  const headers = ['PropertyID', 'Email Người Tạo', 'Người chỉnh sửa', 'Note'];
  const dry = columnReport(headers);
  assert.deepEqual(
    dry.map((entry) => [entry.column, entry.state]),
    [
      ['PropertyID', 'mapped'],
      ['Email Người Tạo', 'blocked'],
      ['Người chỉnh sửa', 'blocked'],
      ['Note', 'unmapped'],
    ],
  );
  const write = columnReport(headers, { write: true });
  assert.deepEqual(
    write.map((entry) => [entry.column, entry.state]),
    [
      ['PropertyID', 'mapped'],
      ['Email Người Tạo', 'mapped'],
      ['Người chỉnh sửa', 'mapped'],
      ['Note', 'unmapped'],
    ],
  );
  assert.match(write[1].detail, /public\.employees/);
  assert.match(write[1].detail, /created_by/);
  assert.equal(write.filter((entry) => entry.state === 'blocked').length, 0);
});

test('a master row carries the captain price rules through to property facts', () => {
  const headers = [
    'PropertyID',
    'Số điện thoai',
    'Tên chủ sở hũu',
    'Loại Hình',
    'Loại Dự án',
    'Tạo mới',
    'Hướng nhà',
    'Giá Bán (tỷ Đồng)',
    'Giá Thuê (triệu Đồng)',
    'Tổng diện tích',
    'Chiều ngang',
    'Chiều dài',
    'Địa chỉ dự án',
    'Thành phố',
    'Quận',
    'Phường',
    'Tên Đường',
    'Địa Chỉ',
    'Ngày Tạo',
    'Kết cấu',
    'Ghi Chú Thêm',
  ];
  const index = Object.fromEntries(
    headers.map((header, position) => [header, position]),
  );
  const reference = buildReference({
    listing: [
      ['TypeID', 'Loại Hình'],
      ['caee82465r', 'Nhà đất bán'],
    ],
    projectType: [
      ['TypeID', 'Loại Hình'],
      ['caee82414', 'Mặt tiền'],
    ],
    status: [['Status'], ['Đang bán']],
  });
  const row = [
    'abc123',
    '0906470481',
    'Cô Kim',
    'caee82465r',
    'Mặt tiền',
    'Đang bán',
    'Bắc',
    '0',
    '0',
    '64m2',
    '4',
    '16',
    '284/41/3 Lý Thường Kiệt, Phường 14, Quận 10',
    'Thành phố Hồ Chí Minh',
    'Quận 10',
    'Phường 14',
    'Lý Thường Kiệt',
    '284/41/3',
    '24/03/2024',
    '',
    '',
  ];
  const { mapped } = mapMasterRow(row, index, reference, '2026-10-18');
  assert.equal(mapped.price_rule, 'price_on_application');
  assert.equal(mapped.property.sale_price_vnd, null);
  assert.equal(mapped.property.status, 'negotiating');
  assert.equal(mapped.property.entry_on, '2024-03-24');
  assert.equal(mapped.property.entry_source, 'legacy');
  assert.equal(mapped.property.land_area_m2, '64');

  const tooHigh = [...row];
  tooHigh[7] = '250';
  assert.equal(
    mapMasterRow(tooHigh, index, reference, '2026-10-18').mapped.price_rule,
    'price_ceiling',
  );

  const rentalOnly = [...row];
  rentalOnly[7] = '';
  rentalOnly[8] = '15';
  assert.equal(
    mapMasterRow(rentalOnly, index, reference, '2026-10-18').mapped.price_rule,
    'rental_only',
  );

  const missing = [...row];
  missing[7] = '';
  missing[8] = '0';
  assert.equal(
    mapMasterRow(missing, index, reference, '2026-10-18').mapped.price_rule,
    'price_missing',
  );
});

test('the listing mode comes from the row’s prices', () => {
  const headers = [
    'PropertyID',
    'Loại Hình',
    'Tạo mới',
    'Giá Bán (tỷ Đồng)',
    'Giá Thuê (triệu Đồng)',
  ];
  const index = Object.fromEntries(
    headers.map((header, position) => [header, position]),
  );
  const reference = buildReference({
    listing: [
      ['TypeID', 'Loại Hình'],
      ['caee82465r', 'Nhà đất bán'],
      ['caee82466r', 'Nhà cho thuê'],
    ],
    status: [['Status'], ['Đang bán']],
  });
  const rowOf = (values) => headers.map((header) => values[header] ?? '');
  const map = (values) =>
    mapMasterRow(rowOf(values), index, reference, '2026-10-18');

  // No listing label at all: the sale price still says what is listed.
  const saleOnly = map({ PropertyID: 'k1', 'Giá Bán (tỷ Đồng)': '23' });
  assert.equal(saleOnly.mapped.property.listing_mode, 'sale');
  assert.ok(saleOnly.issues.includes('listing_mode_missing'));
  assert.equal(
    map({
      PropertyID: 'k2',
      'Giá Bán (tỷ Đồng)': '23',
      'Giá Thuê (triệu Đồng)': '15',
    }).mapped.property.listing_mode,
    'both',
  );
  const rentOnly = map({
    PropertyID: 'k3',
    'Loại Hình': 'caee82466r',
    'Giá Thuê (triệu Đồng)': '15',
  });
  assert.equal(rentOnly.mapped.property.listing_mode, 'rent');
  assert.equal(rentOnly.mapped.price_rule, 'rental_only');
});

test('a status the vocabulary does not define is quarantined, counted and named', () => {
  const headers = ['PropertyID', 'Tạo mới', 'Giá Bán (tỷ Đồng)'];
  const index = Object.fromEntries(
    headers.map((header, position) => [header, position]),
  );
  const reference = buildReference({ status: [['Status'], ['Đang bán']] });
  const rowOf = (values) => headers.map((header) => values[header] ?? '');
  const map = (values) =>
    mapMasterRow(rowOf(values), index, reference, '2026-10-18');
  const bucketOf = (mapped) =>
    recordBucket({
      empty: false,
      sourceKey: mapped.mapped.source_key,
      duplicateKey: false,
      priceRule: mapped.mapped.price_rule,
      status: mapped.mapped.property.status,
      addressStatus: 'resolved',
      issues: mapped.issues,
    });

  // A mapped label keeps the meaning the sheet recorded.
  const known = map({
    PropertyID: 'k4',
    'Tạo mới': 'Đang bán',
    'Giá Bán (tỷ Đồng)': '23',
  });
  assert.equal(known.mapped.property.status, 'available');
  assert.equal(importableBucket(bucketOf(known)), true);

  // `Đã cọc` is not in the vocabulary, so no status is invented and no property is written.
  const deposited = map({
    PropertyID: 'k5',
    'Tạo mới': 'Đã cọc',
    'Giá Bán (tỷ Đồng)': '23',
  });
  assert.equal(deposited.mapped.property.status, null);
  assert.ok(deposited.issues.includes('status_unmapped'));
  const bucket = bucketOf(deposited);
  assert.equal(bucket, 'quarantined_status_unmapped');
  assert.equal(importableBucket(bucket), false);

  const blank = map({ PropertyID: 'k6', 'Giá Bán (tỷ Đồng)': '23' });
  assert.equal(blank.mapped.property.status, null);
  assert.ok(blank.issues.includes('status_missing'));
  assert.equal(bucketOf(blank), 'quarantined_status_unmapped');

  // Price on application still decides its status, as the captain ruled.
  const onApplication = map({
    PropertyID: 'k7',
    'Tạo mới': 'Đã cọc',
    'Giá Bán (tỷ Đồng)': '0',
  });
  assert.equal(onApplication.mapped.property.status, 'negotiating');
  assert.equal(importableBucket(bucketOf(onApplication)), true);

  const summary = statusQuarantine([
    { bucket, source_row: 12, source_key: 'k5', status_raw: 'Đã cọc' },
    {
      bucket: 'quarantined_status_unmapped',
      source_row: 15,
      source_key: 'k6',
      status_raw: 'Đã cọc',
    },
    {
      bucket: 'ready',
      source_row: 16,
      source_key: 'k4',
      status_raw: 'Đang bán',
    },
  ]);
  assert.equal(summary.rows, 2);
  assert.deepEqual(summary.values, [{ value: 'Đã cọc', rows: 2 }]);
  assert.deepEqual(summary.samples, [
    { source_row: 12, source_key: 'k5', status_raw: 'Đã cọc' },
    { source_row: 15, source_key: 'k6', status_raw: 'Đã cọc' },
  ]);
});

test('a row with no listing mode and no price is quarantined, never inserted null', () => {
  const headers = [
    'PropertyID',
    'Loại Hình',
    'Tạo mới',
    'Giá Bán (tỷ Đồng)',
    'Giá Thuê (triệu Đồng)',
  ];
  const index = Object.fromEntries(
    headers.map((header, position) => [header, position]),
  );
  const reference = buildReference({});
  const row = ['k7', '', 'Đã cọc', '', ''];
  const { mapped, issues } = mapMasterRow(row, index, reference, '2026-10-18');
  // Neither the label nor the prices resolve a listing mode, so the row cannot be listed.
  assert.equal(mapped.property.listing_mode, null);
  assert.ok(issues.includes('listing_mode_unresolved'));
  assert.ok(issues.includes('listing_mode_missing'));
  // The run's own disposition decides the write, and this row is not one the write path takes.
  const bucket = recordBucket({
    empty: false,
    sourceKey: mapped.source_key,
    duplicateKey: false,
    priceRule: mapped.price_rule,
    status: mapped.property.status,
    addressStatus: 'resolved',
    issues,
  });
  assert.equal(bucket, 'quarantined_price_missing');
  assert.equal(importableBucket(bucket), false);
  assert.equal(importableBucket('review'), true);
  assert.equal(importableBucket('ready'), true);
});

test('an unreadable rent cell is quarantined and counted, never thrown', () => {
  const headers = [
    'PropertyID',
    'Loại Hình',
    'Tạo mới',
    'Giá Bán (tỷ Đồng)',
    'Giá Thuê (triệu Đồng)',
  ];
  const index = Object.fromEntries(
    headers.map((header, position) => [header, position]),
  );
  const reference = buildReference({});
  const bucketOf = (mapped, issues) =>
    recordBucket({
      empty: false,
      sourceKey: mapped.source_key,
      duplicateKey: false,
      priceRule: mapped.price_rule,
      status: mapped.property.status,
      addressStatus: 'resolved',
      issues,
    });

  const rent = mapMasterRow(
    ['k8', '', 'Đang bán', '23', 'Thoả thuận'],
    index,
    reference,
    '2026-10-18',
  );
  assert.equal(rent.mapped.price_rule, 'rent_unparseable');
  assert.ok(rent.issues.includes('rent_price_unparseable'));
  assert.equal(rent.issues.includes('sale_price_unparseable'), false);
  assert.ok(rent.issues.some((issue) => issue.startsWith('monthly_rent_vnd:')));
  assert.equal(rent.mapped.property.monthly_rent_vnd, null);
  // The readable sale price is kept, so the row is not reported as a sale-price problem.
  assert.equal(rent.mapped.property.sale_price_vnd, '23000000000');
  assert.equal(
    bucketOf(rent.mapped, rent.issues),
    'quarantined_rent_unparseable',
  );

  const sale = mapMasterRow(
    ['k9', '', 'Đang bán', 'Không bán', ''],
    index,
    reference,
    '2026-10-18',
  );
  assert.equal(sale.mapped.price_rule, 'unparseable');
  assert.ok(sale.issues.includes('sale_price_unparseable'));
  assert.equal(sale.issues.includes('rent_price_unparseable'), false);
  assert.equal(
    bucketOf(sale.mapped, sale.issues),
    'quarantined_price_unparseable',
  );
});

test('a development run is refused unless every write target is the development one', () => {
  const dev = 'a'.repeat(20);
  const prod = PRODUCTION_PROJECT_REF;
  const values = {
    SGN_ENV: 'dev',
    DEV_SUPABASE_PROJECT_REF: dev,
    PROD_SUPABASE_PROJECT_REF: prod,
    NEXT_PUBLIC_SUPABASE_URL: `https://${dev}.supabase.co`,
    R2_BUCKET: 'sgn-property-files-dev',
    EXPECTED_R2_BUCKET: 'sgn-property-files-dev',
    R2_ACCOUNT_ID: 'dev-account',
    EXPECTED_R2_ACCOUNT_ID: 'dev-account',
  };
  const direct = `postgresql://postgres:secret@db.${dev}.supabase.co:5432/postgres`;
  const pooled = `postgresql://postgres.${dev}:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`;
  assert.deepEqual(assertWriteTarget(direct, values), {
    stage: 'dev',
    projectRef: dev,
    bucket: 'sgn-property-files-dev',
    account: 'dev-account',
  });
  assert.deepEqual(assertWriteTarget(pooled, values), {
    stage: 'dev',
    projectRef: dev,
    bucket: 'sgn-property-files-dev',
    account: 'dev-account',
  });
  // A production target behind a development label is refused before any connection is opened,
  // and the message names both references.
  const named = (error) =>
    error.message.includes(prod) && error.message.includes(dev);
  assert.throws(
    () =>
      assertWriteTarget(
        `postgresql://postgres:secret@db.${prod}.supabase.co:5432/postgres`,
        values,
      ),
    named,
  );
  // The same production project named as the development one is a label that disagrees with
  // itself, so it is refused rather than compared.
  assert.throws(
    () =>
      assertWriteTarget(direct, {
        ...values,
        DEV_SUPABASE_PROJECT_REF: prod,
      }),
    (error) =>
      error.message.includes('production project') &&
      error.message.includes(prod),
  );
  assert.throws(
    () =>
      assertWriteTarget(direct, {
        ...values,
        NEXT_PUBLIC_SUPABASE_URL: `https://${prod}.supabase.co`,
      }),
    named,
  );
  assert.throws(
    () =>
      assertWriteTarget(
        'postgresql://postgres:secret@127.0.0.1:54322/postgres',
        values,
      ),
    /names no target to check/,
  );
  assert.throws(
    () =>
      assertWriteTarget(direct, {
        ...values,
        NEXT_PUBLIC_SUPABASE_URL: 'not a url',
      }),
    /NEXT_PUBLIC_SUPABASE_URL names no target to check/,
  );
  assert.throws(
    () =>
      assertWriteTarget(direct, {
        ...values,
        R2_BUCKET: 'sgn-property-files-prod',
      }),
    (error) =>
      error.message.includes('sgn-property-files-prod') &&
      error.message.includes('sgn-property-files-dev'),
  );
  assert.throws(
    () =>
      assertWriteTarget(direct, {
        ...values,
        R2_BUCKET: '',
        EXPECTED_R2_BUCKET: '',
      }),
    /not configured \(EXPECTED_R2_BUCKET\)/,
  );
  // A development bucket name in another Cloudflare account is still the wrong target.
  assert.throws(
    () =>
      assertWriteTarget(direct, {
        ...values,
        R2_ACCOUNT_ID: 'prod-account',
      }),
    (error) =>
      error.message.includes('R2_ACCOUNT_ID') &&
      error.message.includes('prod-account') &&
      error.message.includes('dev-account'),
  );
  assert.throws(
    () =>
      assertWriteTarget(direct, {
        ...values,
        R2_ACCOUNT_ID: '',
        EXPECTED_R2_ACCOUNT_ID: '',
      }),
    /not configured \(EXPECTED_R2_ACCOUNT_ID\)/,
  );
  assert.throws(
    () => assertWriteTarget(direct, { ...values, SGN_ENV: 'staging' }),
    /SGN_ENV=dev or prod/,
  );
  assert.throws(
    () =>
      assertWriteTarget(direct, {
        SGN_ENV: 'dev',
        NEXT_PUBLIC_SUPABASE_URL: values.NEXT_PUBLIC_SUPABASE_URL,
        R2_BUCKET: values.R2_BUCKET,
        EXPECTED_R2_BUCKET: values.EXPECTED_R2_BUCKET,
        R2_ACCOUNT_ID: values.R2_ACCOUNT_ID,
        EXPECTED_R2_ACCOUNT_ID: values.EXPECTED_R2_ACCOUNT_ID,
      }),
    /not configured/,
  );
  assert.throws(
    () =>
      assertWriteTarget(direct, {
        ...values,
        PROD_SUPABASE_PROJECT_REF: 'b'.repeat(20),
      }),
    /not the production project/,
  );
});

test('a production run writes only the pinned production project, bucket, account and app', () => {
  const dev = 'a'.repeat(20);
  const pooled = `postgresql://postgres.${PRODUCTION_PROJECT_REF}:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
  const values = {
    SGN_ENV: 'prod',
    DEV_SUPABASE_PROJECT_REF: dev,
    NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
    NEXT_PUBLIC_APP_URL: PRODUCTION_APP_URL,
    R2_BUCKET: PRODUCTION_R2_BUCKET,
    EXPECTED_R2_BUCKET: PRODUCTION_R2_BUCKET,
    R2_ACCOUNT_ID: PRODUCTION_R2_ACCOUNT_ID,
    EXPECTED_R2_ACCOUNT_ID: PRODUCTION_R2_ACCOUNT_ID,
  };
  // The production reference is the one this importer pins, whatever the environment says.
  assert.deepEqual(assertWriteTarget(pooled, values), {
    stage: 'prod',
    projectRef: PRODUCTION_PROJECT_REF,
    bucket: PRODUCTION_R2_BUCKET,
    account: PRODUCTION_R2_ACCOUNT_ID,
  });
  assert.deepEqual(
    assertWriteTarget(pooled, { ...values, SGN_ENV: 'production' }),
    {
      stage: 'prod',
      projectRef: PRODUCTION_PROJECT_REF,
      bucket: PRODUCTION_R2_BUCKET,
      account: PRODUCTION_R2_ACCOUNT_ID,
    },
  );
  const namesProduction = (error) =>
    error.message.includes(PRODUCTION_PROJECT_REF) &&
    error.message.includes(dev);
  // A production label on any other project is refused, before anything is written.
  assert.throws(
    () =>
      assertWriteTarget(
        `postgresql://postgres:secret@db.${dev}.supabase.co:5432/postgres`,
        values,
      ),
    namesProduction,
  );
  assert.throws(
    () =>
      assertWriteTarget(pooled, {
        ...values,
        NEXT_PUBLIC_SUPABASE_URL: `https://${dev}.supabase.co`,
      }),
    namesProduction,
  );
  // The bucket and account the files go to are pinned for production, so an environment that
  // declares another account's storage is refused instead of proving itself.
  assert.throws(
    () => assertWriteTarget(pooled, { ...values, R2_BUCKET: 'someone-elses' }),
    (error) =>
      error.message.includes('someone-elses') &&
      error.message.includes(PRODUCTION_R2_BUCKET),
  );
  assert.throws(
    () =>
      assertWriteTarget(pooled, {
        ...values,
        R2_BUCKET: 'someone-elses',
        EXPECTED_R2_BUCKET: 'someone-elses',
      }),
    (error) =>
      error.message.includes('EXPECTED_R2_BUCKET names someone-elses') &&
      error.message.includes(PRODUCTION_R2_BUCKET),
  );
  assert.throws(
    () =>
      assertWriteTarget(pooled, {
        ...values,
        R2_ACCOUNT_ID: 'someone-elses',
        EXPECTED_R2_ACCOUNT_ID: 'someone-elses',
      }),
    (error) =>
      error.message.includes('EXPECTED_R2_ACCOUNT_ID names someone-elses') &&
      error.message.includes(PRODUCTION_R2_ACCOUNT_ID),
  );
  assert.throws(
    () => assertWriteTarget(pooled, { ...values, EXPECTED_R2_BUCKET: '' }),
    /production R2 bucket is not configured/,
  );
  // A production run whose invitations would point at another deployment is refused.
  assert.throws(
    () =>
      assertWriteTarget(pooled, {
        ...values,
        NEXT_PUBLIC_APP_URL: `https://${dev}.supabase.co`,
      }),
    (error) =>
      error.message.includes('NEXT_PUBLIC_APP_URL') &&
      error.message.includes(PRODUCTION_APP_URL),
  );
  assert.throws(
    () => assertWriteTarget(pooled, { ...values, NEXT_PUBLIC_APP_URL: '' }),
    /NEXT_PUBLIC_APP_URL names \(nothing\)/,
  );
});

test('a converted address the project has no unit for is counted and named by unit code', () => {
  const summary = convertedSkipped([
    {
      source_row: 3,
      source_key: 'k3',
      province_code: '79',
      commune_code: '26734',
    },
    {
      source_row: 9,
      source_key: 'k9',
      province_code: '79',
      commune_code: '26734',
    },
    {
      source_row: 21,
      source_key: 'k21',
      province_code: '01',
      commune_code: '00001',
    },
  ]);
  assert.equal(summary.rows, 3);
  assert.deepEqual(summary.codes, [
    { code: '79/26734', rows: 2 },
    { code: '01/00001', rows: 1 },
  ]);
  assert.deepEqual(convertedSkipped([]), { rows: 0, codes: [] });
});

test('an unreachable official reference keeps the legacy address instead of guessing a unit', async () => {
  const source = {
    city: 'Thành phố Hồ Chí Minh',
    district: 'Quận 3',
    ward: 'Phường 08',
  };
  const pairKey = `${adminNameKey(source.district)}|${adminNameKey(source.ward)}`;
  const context = {
    catalogue: { provinces: new Map(), communes: new Map() },
    reference: { wardPairs: new Map([[pairKey, {}]]) },
    legacyReference: false,
    legacyTree: () => null,
    convertLegacyWard: async () => {
      throw new Error('the official reference must not be consulted');
    },
  };
  const unavailable = await resolveAddress(source, context);
  assert.equal(unavailable.status, 'official_reference_unavailable');
  assert.equal(unavailable.target, undefined);
  // The reasons the run can still establish without the reference are kept as they were.
  assert.equal(
    (
      await resolveAddress(
        { city: source.city, district: source.district },
        context,
      )
    ).status,
    'missing_ward',
  );
  // A province tree that failed is the same counted reason, while a city the reference simply
  // does not name stays its own reason.
  assert.equal(
    (
      await resolveAddress(source, {
        ...context,
        legacyReference: true,
        legacyTreeFailure: () => 'socket hang up',
      })
    ).status,
    'official_reference_unavailable',
  );
  assert.equal(
    (await resolveAddress(source, { ...context, legacyReference: true }))
      .status,
    'unknown_city',
  );
  // With the reference available the same triple is consulted exactly as before.
  const consulted = [];
  const available = {
    ...context,
    legacyReference: true,
    legacyTree: () => ({
      districts: [
        { name: 'Quận 3', wards: [{ name: 'Phường 08', code: '26734' }] },
      ],
    }),
    convertLegacyWard: async (code) => {
      consulted.push(code);
      return [];
    },
  };
  assert.equal(
    (await resolveAddress(source, available)).status,
    'no_current_ward',
  );
  assert.deepEqual(consulted, ['26734']);
  // A ward conversion that failed degrades the same way instead of aborting the run.
  assert.equal(
    (
      await resolveAddress(source, {
        ...available,
        convertLegacyWard: async () => null,
      })
    ).status,
    'official_reference_unavailable',
  );
});

test('a ward label that already names one current commune needs no official reference', async () => {
  const source = {
    city: 'Thành phố Hồ Chí Minh',
    district: 'Quận 3',
    ward: 'Phường 08',
  };
  const context = {
    catalogue: {
      provinces: new Map([
        ['79', { code: '79', name: 'Thành phố Hồ Chí Minh' }],
      ]),
      communes: new Map([
        ['26734|79', { code: '26734', name: 'Phường 08', province: '79' }],
      ]),
    },
    reference: { wardPairs: new Map() },
    legacyReference: false,
    legacyTree: () => null,
    convertLegacyWard: async () => {
      throw new Error('the official reference must not be consulted');
    },
  };
  const resolved = await resolveAddress(source, context);
  assert.equal(resolved.status, 'current_name');
  assert.deepEqual(resolved.target, [
    {
      code: '26734',
      name: 'Phường 08',
      provinceCode: '79',
      provinceName: 'Thành phố Hồ Chí Minh',
    },
  ]);
  // A different ward label is still refused rather than guessed.
  assert.equal(
    (await resolveAddress({ ...source, ward: 'Phường 09' }, context)).status,
    'unlisted_legacy_pair',
  );
});

test('a placeholder owner creates no contact row, a named owner does', () => {
  assert.equal(isPlaceholderOwner('Chưa có tên'), true);
  assert.equal(isPlaceholderOwner('tìm chủ'), true);
  assert.equal(isPlaceholderOwner('cn'), true);
  assert.equal(isPlaceholderOwner('a cn'), true);
  assert.equal(isPlaceholderOwner('Chủ nhà'), true);
  assert.equal(isPlaceholderOwner('.'), true);
  assert.equal(isPlaceholderOwner(''), true);
  assert.equal(isPlaceholderOwner('A Hải'), false);
  assert.equal(isPlaceholderOwner('Chị Trang cháu chủ nhà'), false);
  assert.equal(isPlaceholderOwner('cô loan chú tuấn'), false);

  const reference = buildReference({});
  const headers = [
    'PropertyID',
    'Tên chủ sở hũu',
    'Địa chỉ dự án',
    'Thành phố',
    'Quận',
    'Phường',
    'Giá Bán (tỷ Đồng)',
  ];
  const index = Object.fromEntries(
    headers.map((header, position) => [header, position]),
  );
  const placeholder = headers.map(() => '');
  placeholder[index.PropertyID] = 'fab916000';
  placeholder[index['Địa chỉ dự án']] = '72 Ký Hòa, Phường 11, Quận 5';
  placeholder[index['Tên chủ sở hũu']] = 'Chưa có tên';
  placeholder[index['Giá Bán (tỷ Đồng)']] = '25';
  const mapped = mapMasterRow(placeholder, index, reference, '2026-10-18');
  assert.equal(mapped.mapped.contact, null);
  assert.ok(mapped.issues.includes('owner_placeholder'));
  placeholder[index['Tên chủ sở hũu']] = 'Chị Yến';
  assert.equal(
    mapMasterRow(placeholder, index, reference, '2026-10-18').mapped.contact
      .display_name,
    'Chị Yến',
  );
});

test('a child row joins only on an exact PropertyID and is dropped otherwise', () => {
  const masterByKey = new Map([['abc123', 'abc123']]);
  assert.deepEqual(classifyChildReference('abc123', masterByKey), {
    kind: 'direct_key',
    propertyKey: 'abc123',
  });
  // The BDS row-number hypothesis is disproved against the live sheet, so it is not a join.
  assert.deepEqual(classifyChildReference('BDS-900', masterByKey), {
    kind: 'unmatched',
  });
  assert.deepEqual(classifyChildReference('nonsense', masterByKey), {
    kind: 'unmatched',
  });
  assert.deepEqual(classifyChildReference('   ', masterByKey), {
    kind: 'empty_key',
  });
});

test('VietMap boundaries resolve against the project catalogue, never by name alone across provinces', () => {
  const catalogue = {
    provinces: new Map([
      ['79', { code: '79', name: 'Thành phố Hồ Chí Minh' }],
      ['01', { code: '01', name: 'Thành phố Hà Nội' }],
    ]),
    communes: new Map([
      ['26769|79', { code: '26769', name: 'Phường Diên Hồng', province: '79' }],
      ['26770|79', { code: '26770', name: 'Phường Vườn Lài', province: '01' }],
    ]),
    byProvince: new Map([
      ['79', [{ code: '26769', name: 'Phường Diên Hồng', province: '79' }]],
      ['01', [{ code: '26770', name: 'Phường Vườn Lài', province: '01' }]],
    ]),
  };
  const resolved = vietMapBoundaryTarget(
    [
      {
        type: 2,
        name: 'Diên Hồng',
        prefix: 'Phường',
        full_name: 'Phường Diên Hồng',
      },
      {
        type: 0,
        name: 'Hồ Chí Minh',
        prefix: 'Thành Phố',
        full_name: 'Thành Phố Hồ Chí Minh',
      },
    ],
    catalogue,
  );
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.target.code, '26769');
  assert.equal(vietMapBoundaryTarget([], catalogue).status, 'empty_boundaries');
  assert.equal(
    vietMapBoundaryTarget(
      [
        {
          type: 2,
          name: 'Vườn Lài',
          prefix: 'Phường',
          full_name: 'Phường Vườn Lài',
        },
        {
          type: 0,
          name: 'Hồ Chí Minh',
          prefix: 'Thành Phố',
          full_name: 'Thành Phố Hồ Chí Minh',
        },
      ],
      catalogue,
    ).status,
    'catalogue_missing_commune',
  );
});

test('a write is refused unless the confirmation names this exact snapshot', () => {
  const digest = 'abc';
  const base = {
    source_sha256: digest,
    confirmed_by: 'captain',
    confirmed_at: '2026-10-18T00:00:00Z',
  };
  assert.deepEqual(confirmationProblems(null, { digest }), [
    'no confirmation file was supplied',
  ]);
  assert.match(
    confirmationProblems(
      { ...base, source_sha256: 'other' },
      { digest },
    ).join(),
    /does not match/,
  );
  assert.match(
    confirmationProblems({ ...base, confirmed_by: '' }, { digest }).join(),
    /confirmed_by is missing/,
  );
  assert.match(
    confirmationProblems(
      { ...base, confirmed_at: 'not-a-date' },
      { digest },
    ).join(),
    /not a date/,
  );
  // The settled rules cover a refused address, so the gate asks for no per-address decision.
  assert.deepEqual(confirmationProblems(base, { digest }), []);
});

test('the roster position decides the role and admin stays with the captain', () => {
  assert.equal(
    staffRoleFor({ email: 'a@example.com', position: 'TPKD' }),
    'manager',
  );
  assert.equal(
    staffRoleFor({ email: 'a@example.com', position: 'Thư ký' }),
    'staff',
  );
  assert.equal(
    staffRoleFor({ email: 'a@example.com', position: 'Admin' }),
    'sales',
  );
  assert.equal(staffRoleFor({ email: 'a@example.com', position: '' }), 'sales');
  assert.equal(
    staffRoleFor({ email: 'a@example.com', position: 'Kế toán' }),
    'sales',
  );
  assert.equal(
    staffRoleFor({
      email: 'manager.sgnewhouse@gmail.com',
      position: 'Admin',
      silentAdminEmail: 'manager.sgnewhouse@gmail.com',
    }),
    'admin',
  );
});

test('staff accounts are every master address plus the roster, each with one role', () => {
  const plan = planStaffAccounts({
    masterEmails: ['b@example.com', 'c@example.com', 'b@example.com'],
    employeeRows: [
      { email: 'b@example.com', name: 'B', position: 'TPKD' },
      { email: 'd@example.com', name: 'D', position: 'Thư ký' },
      { email: '', name: 'blank', position: 'TPKD' },
    ],
    silentAdminEmail: 'manager.sgnewhouse@gmail.com',
  });
  assert.deepEqual(
    plan.map((entry) => [entry.email, entry.role, entry.silent]),
    [
      ['b@example.com', 'manager', false],
      ['c@example.com', 'sales', false],
      ['d@example.com', 'staff', false],
    ],
  );
  assert.equal(
    plan.find((entry) => entry.email === 'b@example.com').display_name,
    'B',
  );
  assert.equal(
    plan.find((entry) => entry.email === 'd@example.com').source,
    'employee_tab',
  );
});

test('a duplicate, an oversized or a slotted-out attachment is dropped by reason', () => {
  const propertiesByKey = new Map([
    ['k1', 'p1'],
    ['k2', 'p2'],
  ]);
  const driveFiles = new Map([
    ['Attachments_Images/a.jpg', { id: 'f1', name: 'a.jpg', size: 1024 }],
    [
      'Attachments_Images/b.jpg',
      { id: 'f2', name: 'b.jpg', size: 6 * 1024 * 1024 },
    ],
    ['Attachments_Images/c.pdf', { id: 'f3', name: 'c.pdf', size: 4096 }],
    ['Attachments_Images/d.txt', { id: 'f4', name: 'd.txt', size: 10 }],
  ]);
  const rows = [
    {
      source_row: 2,
      legacy_id: 'id1',
      property_key: 'k1',
      url: 'Attachments_Images/a.jpg',
    },
    {
      source_row: 3,
      legacy_id: 'id2',
      property_key: 'k1',
      url: 'Attachments_Images/a.jpg',
    },
    {
      source_row: 4,
      legacy_id: 'id3',
      property_key: 'k1',
      url: 'Attachments_Images/b.jpg',
    },
    {
      source_row: 5,
      legacy_id: 'id4',
      property_key: 'k9',
      url: 'Attachments_Images/a.jpg',
    },
    {
      source_row: 6,
      legacy_id: 'id5',
      property_key: 'k1',
      url: 'Attachments_Images/missing.jpg',
    },
    {
      source_row: 7,
      legacy_id: 'id6',
      property_key: 'k1',
      url: 'Attachments_Images/d.txt',
    },
    {
      source_row: 8,
      legacy_id: 'id7',
      property_key: 'k2',
      url: 'Attachments_Images/c.pdf',
    },
  ];
  const result = planAttachmentImport({ rows, propertiesByKey, driveFiles });
  assert.deepEqual(
    result.plan.map((row) => row.source_row),
    [2, 8],
  );
  assert.deepEqual(
    result.plan.map((row) => row.file_class),
    ['image', 'document'],
  );
  const dropped = Object.fromEntries(
    result.dropped.map((entry) => [entry.reason, entry.count]),
  );
  assert.equal(dropped.repeated_attachment, 1);
  assert.equal(dropped.over_image_limit, 1);
  assert.equal(dropped.property_not_imported, 1);
  assert.equal(dropped.missing_drive_file, 1);
  assert.equal(dropped.unsupported_type, 1);
  assert.equal(result.total_bytes, 1024 + 4096);
});

test('attachments are planned only for the properties the run would create', () => {
  const records = [
    { source_key: 'ready-key', bucket: 'ready' },
    { source_key: 'review-key', bucket: 'review' },
    { source_key: 'deposited-key', bucket: 'quarantined_status_unmapped' },
    { source_key: 'priced-key', bucket: 'quarantined_price_ceiling' },
  ];
  const propertiesByKey = importablePropertyKeys(records);
  assert.deepEqual([...propertiesByKey.keys()], ['ready-key', 'review-key']);

  const driveFiles = new Map([
    ['Attachments_Images/a.jpg', { id: 'f1', name: 'a.jpg', size: 1024 }],
    ['Attachments_Images/b.jpg', { id: 'f2', name: 'b.jpg', size: 1024 }],
  ]);
  const rows = [
    {
      source_row: 2,
      legacy_id: 'id1',
      property_key: 'ready-key',
      url: 'Attachments_Images/a.jpg',
    },
    {
      source_row: 3,
      legacy_id: 'id2',
      property_key: 'deposited-key',
      url: 'Attachments_Images/b.jpg',
    },
  ];
  const result = planAttachmentImport({ rows, propertiesByKey, driveFiles });
  assert.deepEqual(
    result.plan.map((row) => row.source_row),
    [2],
  );
  assert.deepEqual(result.dropped, [
    { reason: 'property_not_imported', count: 1 },
  ]);
});

test('the declared stage and the invitation origin are normalised once', () => {
  assert.equal(declaredStage({ SGN_ENV: 'prod' }), 'prod');
  assert.equal(declaredStage({ SGN_ENV: ' Production ' }), 'prod');
  assert.equal(declaredStage({ SGN_ENV: 'local' }), 'dev');
  assert.equal(declaredStage({ SGN_ENV: 'staging' }), null);
  assert.equal(declaredStage({}), null);
  assert.equal(
    invitationOrigin('https://sgnewhouse.online/'),
    'https://sgnewhouse.online',
  );
  assert.equal(
    invitationOrigin(' http://localhost:3101 '),
    'http://localhost:3101',
  );
  assert.equal(invitationOrigin(undefined), '');
});

test('each invitation renders what happened to it and whether it is recorded', () => {
  const sends = [
    {
      email: 'accepted@example.com',
      outcome: 'accepted',
      recorded: true,
      detail: null,
    },
    {
      email: 'refused-send@example.com',
      outcome: 'failed',
      recorded: true,
      detail: 'provider refused',
    },
    {
      email: 'ambiguous@example.com',
      outcome: 'ambiguous',
      recorded: true,
      detail: 'no identity',
    },
    {
      email: 'unwritten@example.com',
      outcome: 'accepted',
      recorded: false,
      detail: '409',
    },
  ];
  const invitations = [
    ...sends.map((send) => ({
      email: send.email,
      role: 'sales',
      stated: true,
      state: 'pending',
      detail: null,
    })),
    {
      email: 'already@example.com',
      role: 'admin',
      stated: true,
      state: 'recorded',
      detail: null,
    },
    {
      email: 'not-stated@example.com',
      role: 'staff',
      stated: false,
      state: null,
      detail: '409 conflict',
    },
    {
      email: 'never-sent@example.com',
      role: 'manager',
      stated: true,
      state: 'pending',
      detail: null,
    },
  ];
  const recipients = invitationRecipients(invitations, sends);
  assert.deepEqual(
    recipients.map((entry) => [
      entry.email,
      entry.role,
      entry.outcome,
      entry.recorded,
    ]),
    [
      ['accepted@example.com', 'sales', 'accepted', true],
      // A recorded outcome write does not make a refused or ambiguous send a recorded invitation.
      ['refused-send@example.com', 'sales', 'failed', false],
      ['ambiguous@example.com', 'sales', 'ambiguous', false],
      ['unwritten@example.com', 'sales', 'accepted', false],
      ['already@example.com', 'admin', 'already_recorded', true],
      ['not-stated@example.com', 'staff', 'refused', false],
      ['never-sent@example.com', 'manager', 'not_sent', false],
    ],
  );
  assert.equal(
    recipients.find((entry) => entry.email === 'refused-send@example.com')
      .detail,
    'provider refused',
  );
  assert.equal(
    recipients.find((entry) => entry.email === 'not-stated@example.com').detail,
    '409 conflict',
  );
  // The per-invitation flags are the same predicate the recorded count uses.
  const emailed = recipients.filter((entry) =>
    sends.some((send) => send.email === entry.email),
  );
  assert.equal(
    emailed.filter((entry) => entry.recorded).length,
    recordedInvitations(sends),
  );
});

test('only an accepted provider outcome counts as a recorded invitation', () => {
  const sends = [
    { email: 'a@example.com', outcome: 'accepted', recorded: true },
    // The RPC accepted a failed outcome, so the invitation sits in provider_failed, not recorded.
    { email: 'b@example.com', outcome: 'failed', recorded: true },
    { email: 'c@example.com', outcome: 'ambiguous', recorded: true },
    // The provider accepted, but the outcome write was refused: the state is not recorded.
    { email: 'd@example.com', outcome: 'accepted', recorded: false },
  ];
  assert.equal(recordedInvitations(sends), 1);
  assert.equal(recordedInvitations([]), 0);
});

test('the report claims only what the run actually did', () => {
  const headers = ['Email Người Tạo', 'Người chỉnh sửa'];
  const refused = {
    write_outcome: {
      state: 'refused',
      reason: 'the confirmation names another digest',
    },
  };
  const completed = {
    write: {},
    write_outcome: { state: 'completed', reason: null },
  };
  const dry = { write_outcome: { state: 'dry_run', reason: null } };

  assert.equal(writeOutcome(dry).state, 'dry_run');
  assert.equal(writeOutcome(dry).rosterResolved, false);
  assert.equal(writeOutcome(refused).title, 'write refused');
  assert.equal(writeOutcome(refused).label, 'refused write run');
  assert.equal(writeOutcome(refused).rosterResolved, false);
  assert.equal(
    writeOutcome(refused).reason,
    'the confirmation names another digest',
  );
  assert.equal(writeOutcome(completed).rosterResolved, true);

  // A refused write never read the roster, so the columns it never resolved stay blocked.
  for (const report of [dry, refused]) {
    const columns = columnReport(headers, {
      write: writeOutcome(report).rosterResolved,
    });
    assert.deepEqual(
      columns.map((entry) => entry.state),
      ['blocked', 'blocked'],
    );
  }
  assert.deepEqual(
    columnReport(headers, {
      write: writeOutcome(completed).rosterResolved,
    }).map((entry) => entry.state),
    ['mapped', 'mapped'],
  );
  // A write that failed after committing rows says so, and claims no roster it did not finish.
  const failed = {
    write_outcome: { state: 'failed', reason: 'the connection dropped' },
  };
  assert.equal(writeOutcome(failed).state, 'failed');
  assert.equal(writeOutcome(failed).title, 'write failed');
  assert.equal(writeOutcome(failed).label, 'failed write run');
  assert.equal(writeOutcome(failed).rosterResolved, false);
  assert.equal(writeOutcome(failed).reason, 'the connection dropped');
  assert.deepEqual(
    columnReport(headers, {
      write: writeOutcome(failed).rosterResolved,
    }).map((entry) => entry.state),
    ['blocked', 'blocked'],
  );

  // A report written before the outcome was recorded is a dry run, never a completed write.
  assert.equal(writeOutcome({}).state, 'dry_run');
});

test('contact counts cover only the properties the run would create', () => {
  const contact = (display_name, phones = []) => ({
    display_name,
    phones,
    raw_phone_text: phones.join(' '),
  });
  const record = (bucket, contact, issues = []) => ({
    bucket,
    contact_key: contact ? contactKey(contact) : null,
    mapped: { contact },
    issues,
  });
  const kim = contact('Cô Kim', ['+84902467845']);
  const hoa = contact('Chị Hoa');
  const stats = contactSummary([
    record('ready', kim),
    record('review', hoa),
    record('ready', hoa),
    record('quarantined_price_ceiling', contact('Anh Tú')),
    record('quarantined_status_unmapped', contact('Chị Hoa')),
    record('ready', null, ['owner_placeholder']),
  ]);
  // Anh Tú's only row is quarantined and written nowhere, so he is not one of the run's contacts.
  assert.equal(stats.distinct, 2);
  assert.equal(stats.rows_with_owner, 3);
  assert.equal(stats.rows_without_owner, 1);
  assert.equal(stats.placeholder_owner_rows, 1);
  assert.equal(stats.shared, 1);
  assert.deepEqual(stats.examples, [
    { display_name: 'Chị Hoa', phones: [], rows: 2 },
  ]);
});

test('the employee tab is requested without its credential columns', async () => {
  const tabs = {
    'Nhân viên': [
      ['Tên Nhân Viên', 'Password', 'Email', 'Monitor', 'Chức vụ'],
      ['Hồng', '12345678', 'hong@example.com', 'x', 'TPKD'],
      ['Lan', '87654321', 'lan@example.com', 'y', 'Thư ký'],
    ],
    'Bất động sản': [
      ['PropertyID', 'Giá Bán (tỷ Đồng)'],
      ['abc123', '23'],
    ],
    Login: [
      ['Email', 'Password'],
      ['someone@example.com', 'secret'],
    ],
  };
  const index = (column) => column.charCodeAt(0) - 65;
  const respond = (body) => ({ ok: true, status: 200, json: async () => body });
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    const decoded = decodeURIComponent(url);
    if (decoded.includes('?fields='))
      return respond({
        properties: { title: 'SGN' },
        sheets: Object.entries(tabs).map(([title, rows]) => ({
          properties: {
            title,
            gridProperties: { rowCount: rows.length },
          },
        })),
      });
    const header = /values\/'([^']+)'!1:1/.exec(decoded);
    if (header) return respond({ values: [tabs[header[1]][0]] });
    if (decoded.includes('values:batchGet'))
      return respond({
        valueRanges: new URL(url).searchParams.getAll('ranges').map((range) => {
          const [, title, from, to] = /'([^']+)'!([A-Z]+)1:([A-Z]+)/.exec(
            range,
          );
          return {
            range,
            values: tabs[title].map((row) =>
              row.slice(index(from), index(to) + 1),
            ),
          };
        }),
      });
    throw new Error(`unexpected request: ${decoded}`);
  };

  const sheet = await readSpreadsheet('token', 'spreadsheet-id', fetchImpl);

  // The sign-in tab and the credential cells are never requested at all.
  assert.equal(
    requests.some((url) => decodeURIComponent(url).includes('Login')),
    false,
  );
  const read = requests
    .filter((url) => decodeURIComponent(url).includes('values:batchGet'))
    .flatMap((url) => new URL(url).searchParams.getAll('ranges'))
    .filter((range) => range.startsWith("'Nhân viên'"))
    .flatMap((range) => {
      const [, from, to] = /!([A-Z]+)1:([A-Z]+)/.exec(range);
      return Array.from(
        { length: index(to) - index(from) + 1 },
        (_, offset) => index(from) + offset,
      );
    });
  assert.deepEqual([...new Set(read)].sort(), [0, 2, 4]);

  // The credential cells never arrive, and every other cell stays in its header column.
  assert.deepEqual(sheet.tabs.get('Nhân viên'), [
    ['Tên Nhân Viên', '', 'Email', '', 'Chức vụ'],
    ['Hồng', '', 'hong@example.com', '', 'TPKD'],
    ['Lan', '', 'lan@example.com', '', 'Thư ký'],
  ]);
  assert.deepEqual(rosterEmployees(sheet.tabs.get('Nhân viên')), [
    { name: 'Hồng', email: 'hong@example.com', position: 'TPKD' },
    { name: 'Lan', email: 'lan@example.com', position: 'Thư ký' },
  ]);
  assert.deepEqual(
    sheet.excluded.map((entry) => `${entry.tab}/${entry.column}`),
    ['Nhân viên/Password', 'Nhân viên/Monitor'],
  );
  // A tab with no credential column is read whole.
  assert.deepEqual(sheet.tabs.get('Bất động sản'), [
    ['PropertyID', 'Giá Bán (tỷ Đồng)'],
    ['abc123', '23'],
  ]);
  assert.deepEqual(sheet.skipped, ['Login']);
});

test('a Vietnamese-spelled password header is credential material too', () => {
  assert.deepEqual(
    credentialColumns(['Tên', 'Email', 'Mật khẩu', 'Chức vụ']).map(
      (entry) => entry.position,
    ),
    [2],
  );
});

test('the roster position is read by header, not by where a credential column left it', () => {
  const rows = [
    ['Tên', 'Email', 'Mật khẩu', 'Chức vụ'],
    ['Hồng', 'hong@example.com', '12345678', 'TPKD'],
    ['Lan', 'lan@example.com', '87654321', 'Thư ký'],
    ['Minh', 'minh@example.com', '11112222', 'Admin'],
  ];
  assert.deepEqual(rosterEmployees(rows), [
    { name: 'Hồng', email: 'hong@example.com', position: 'TPKD' },
    { name: 'Lan', email: 'lan@example.com', position: 'Thư ký' },
    { name: 'Minh', email: 'minh@example.com', position: 'Admin' },
  ]);
});

test('an invitation phase that dies partway still names every address it reached', async () => {
  const invitation = (email, role, index) => ({
    email,
    role,
    stated: true,
    state: 'pending',
    detail: null,
    invitation_id: `0000000${index}-0000-4000-8000-00000000000${index}`,
    revision: 1,
  });
  const invitations = [
    invitation('reached@example.com', 'sales', 1),
    invitation('dropped@example.com', 'manager', 2),
    invitation('never@example.com', 'staff', 3),
  ];
  const saved = {};
  for (const key of [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_APP_URL',
  ]) {
    saved[key] = process.env[key];
  }
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    NEXT_PUBLIC_APP_URL: 'https://sgnewhouse.online',
  });
  const jsonResponse = (status, body) => ({
    ok: status < 400,
    status,
    text: async () => JSON.stringify(body),
  });
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/v1/invite')) {
      const { email } = JSON.parse(options.body);
      if (email === 'dropped@example.com') throw new TypeError('fetch failed');
      return jsonResponse(200, {
        id: '3f4a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b',
        email,
      });
    }
    return jsonResponse(200, null);
  };
  const invitationsSent = [];
  let summary;
  try {
    await assert.rejects(
      sendInvitations({
        invitations,
        actorId: null,
        outcomes: invitationsSent,
        log: () => {},
      }),
      /fetch failed/,
    );
    summary = invitationSummary(invitations, invitationsSent);
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  // The address whose connection dropped keeps the attempt, so the run never loses who it emailed.
  assert.deepEqual(
    invitationsSent.map((entry) => [
      entry.email,
      entry.outcome,
      entry.recorded,
    ]),
    [
      ['reached@example.com', 'accepted', true],
      ['dropped@example.com', 'attempted', false],
    ],
  );
  const invitationsReported = invitationRecipients(
    invitations,
    invitationsSent,
  );
  assert.deepEqual(
    invitationsReported.map((entry) => [
      entry.email,
      entry.outcome,
      entry.recorded,
    ]),
    [
      ['reached@example.com', 'accepted', true],
      ['dropped@example.com', 'attempted', false],
      ['never@example.com', 'not_sent', false],
    ],
  );
  // A failed write keeps the same list in the report instead of dropping it with the write.
  assert.equal(summary.recorded, 1);
  assert.equal(summary.origin, 'https://sgnewhouse.online');
  assert.deepEqual(
    summary.failures.map((entry) => entry.outcome),
    ['attempted'],
  );
  const rendered = renderReport({
    generated_at: '2026-10-18T00:00:00Z',
    spreadsheet_id: 'sheet',
    spreadsheet_title: 'title',
    drive_folder_id: 'folder',
    service_account: 'sa@example.com',
    digest: 'abc',
    out_dir: '/tmp/out',
    stage: 'prod',
    stage_proven: true,
    write_outcome: { state: 'failed', reason: 'the connection dropped' },
    counts: {
      total_rows: 1,
      empty_rows: 0,
      missing_id_rows: 0,
      distinct_keys: 1,
      duplicate_keys: 0,
      ready_rows: 1,
      review_rows: 0,
      quarantined_rows: 0,
      excluded_rows: 0,
      buckets: [],
    },
    prices: {
      missing: 0,
      ceiling: 0,
      on_application: 0,
      rental_only: 0,
      unparseable: 0,
      rent_unparseable: 0,
      on_application_samples: [],
    },
    statuses: { rows: 0, values: [], samples: [] },
    samples: {},
    addresses: {
      legacy_reference_unavailable: null,
      legacy_reference_failures: [],
      legacy_reference_rows: 0,
      sources: [],
      vietmap: {
        distinct_addresses: 0,
        cached_resolved: 0,
        cached_empty: 0,
        unique_queries: 0,
        api_calls: 0,
        cache_hits: 0,
        migrate_type_2_calls: 0,
        failed: 0,
      },
      vietmap_statuses: [],
      outcomes: [],
      converted_rows: 0,
      refused_rows: 0,
      crosswalk_note: 'note',
      disagreements: [],
      disagreement_rows: 0,
      unresolved_units: [],
      split_units: [],
      refused_examples: [],
    },
    duplicates: {
      property_keys: [],
      property_key_rows: 0,
      phone_repeats: 0,
      phone_repeat_rows: 0,
      multi_commune_rows: 0,
      examples: [],
    },
    contacts: {
      distinct: 0,
      rows_with_owner: 0,
      shared: 0,
      rows_without_owner: 0,
      placeholder_owner_rows: 0,
      examples: [],
    },
    staff: {
      creator_emails: 0,
      creator_rows: 0,
      editor_emails: 0,
      editor_rows: 0,
    },
    staff_plan: {
      addresses: 0,
      from_roster: 0,
      by_role: [],
      accounts: [],
      silent_admin: null,
      roster_positions: [],
    },
    attachments: {
      folders: [],
      rows: 0,
      matched_files: 0,
      downloadable_bytes: 0,
      unreferenced_files: 0,
      dropped: [],
    },
    children: [],
    issues: [],
    columns: [],
    dropped_tabs: [],
    skipped_tabs: [],
    excluded: [],
    examples: [],
    invitations: summary,
  });
  const lines = rendered.split('\n');
  const heading = lines.findIndex((line) =>
    line.startsWith('## 12. Invitations this run attempted'),
  );
  assert.notEqual(heading, -1);
  const end = lines.findIndex(
    (line, index) => index > heading && line.startsWith('## '),
  );
  const section = lines.slice(heading, end).join('\n');
  for (const email of [
    'reached@example.com',
    'dropped@example.com',
    'never@example.com',
  ]) {
    assert.match(section, new RegExp(email));
  }
  assert.match(section, /attempted/);
  // The limits section keeps its number after the invitations section.
  assert.match(rendered, /^## 13\. Limits of this run$/m);
});
