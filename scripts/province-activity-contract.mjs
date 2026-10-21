import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Ticket #35 embedded regressions: the reviewer-only province table's live manager/admin
// boundary, employee/property/Vietnam-day counting units, canonical verified primary-province
// grouping, the always-reported Unverified group, regrouping after an authorized address
// correction or invalidation with an unchanged company total, retained historical credit and
// range bounds. Real Auth/Data API/RLS and browser acceptance stay a staging gate; this proves
// the database rules the application reads, including the reconciliation with the company
// employee-by-day report it shares its counting units with.
export async function provinceActivityContract({
  db,
  asUser,
  check,
  fails,
  employees,
}) {
  const asOwner = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };

  const [
    pA1,
    pA2,
    pB1,
    legacyOnly,
    candidate,
    archivedProperty,
    legacyLocated,
  ] = [
    '72000000-0000-4000-8000-0000000000a1',
    '72000000-0000-4000-8000-0000000000a2',
    '72000000-0000-4000-8000-0000000000b1',
    '72000000-0000-4000-8000-0000000000c1',
    '72000000-0000-4000-8000-0000000000c2',
    '72000000-0000-4000-8000-0000000000d1',
    '72000000-0000-4000-8000-0000000000e1',
  ];
  const properties = [
    pA1,
    pA2,
    pB1,
    legacyOnly,
    candidate,
    archivedProperty,
    legacyLocated,
  ];
  // Two catalog versions of one official province code (the canonical-identity case), one
  // second province, and the commune versions their addresses are verified against.
  const [
    provinceAFirst,
    provinceASecond,
    provinceB,
    communeA,
    communeA2,
    communeB,
  ] = [
    '71000000-0000-4000-8000-0000000000a1',
    '71000000-0000-4000-8000-0000000000a2',
    '71000000-0000-4000-8000-0000000000b1',
    '71000000-0000-4000-8000-0000000000c1',
    '71000000-0000-4000-8000-0000000000c2',
    '71000000-0000-4000-8000-0000000000c3',
  ];
  // The pre-2025 three-tier generation of the same official province code: province → district →
  // commune, closed on 2025-07-01. Legacy addresses reference these rows, never the current ones.
  const [legacyProvince, legacyDistrict, legacyCommune] = [
    '71000000-0000-4000-8000-0000000000e1',
    '71000000-0000-4000-8000-0000000000e2',
    '71000000-0000-4000-8000-0000000000e3',
  ];
  const provinceACode = 'TST-PA';
  const provinceAFirstName = 'Tỉnh Fixture A';
  const provinceARevisedName = 'Tỉnh Fixture A (hiệu chỉnh)';
  const provinceBName = 'Tỉnh Fixture B';
  const legacyRawProvince = 'Thành phố Hồ Chí Minh';
  const legacyProvinceName = 'Tỉnh Fixture A (cũ)';
  const legacyDistrictName = 'Quận Fixture Legacy (cũ)';
  const legacyCommuneName = 'Phường Fixture Legacy (cũ)';
  // Preserved legacy source text, kept apart from every current and legacy catalog label.
  const legacyProvinceText = 'Tỉnh Fixture Legacy';
  const legacyDistrictText = 'Quận Fixture Legacy';
  const legacyCommuneText = 'Phường Fixture Legacy';
  const [sameDay, laterDay] = ['2026-10-05', '2026-10-06'];
  const quietDay = '2026-10-07';
  const legacyDay = '2026-10-08';

  await asOwner();
  await db.query(
    "insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-PROV-1','sale','available',$8),($2,'SGN-PROV-2','sale','available',$8),($3,'SGN-PROV-3','sale','available',$8),($4,'SGN-PROV-4','sale','available',$8),($5,'SGN-PROV-5','sale','available',$8),($6,'SGN-PROV-6','sale','available',$8),($7,'SGN-PROV-7','sale','available',$8)",
    [...properties, employees[0]],
  );
  await db.query(
    "insert into public.admin_unit_versions(id,official_code,name_vi,unit_level,valid_from,source_url) values($1,$4,$5,'province','2025-07-01','https://example.test/catalog'),($2,$4,$6,'province','2026-01-01','https://example.test/catalog'),($3,'TST-PB',$7,'province','2025-07-01','https://example.test/catalog')",
    [
      provinceAFirst,
      provinceASecond,
      provinceB,
      provinceACode,
      provinceAFirstName,
      provinceARevisedName,
      provinceBName,
    ],
  );
  await db.query(
    "insert into public.admin_unit_versions(id,official_code,name_vi,unit_level,parent_id,valid_from,source_url) values($1,'TST-CA','Phường Fixture A','commune',$4,'2025-07-01','https://example.test/catalog'),($2,'TST-CA2','Phường Fixture A2','commune',$5,'2026-01-01','https://example.test/catalog'),($3,'TST-CB','Phường Fixture B','commune',$6,'2025-07-01','https://example.test/catalog')",
    [communeA, communeA2, communeB, provinceAFirst, provinceASecond, provinceB],
  );
  // Current addresses start unresolved and are verified below through the authorized
  // maintenance path. The second catalog version of province A carries one property, so a
  // catalog revision never splits one official province into two report rows.
  await db.query(
    "insert into public.property_addresses(property_id,format,address_text,province_unit_id,commune_unit_id,effective_on,is_primary) values($1,'current','1 Fixture Street, Phường Fixture A, Tỉnh Fixture A',$5,$8,'2025-08-01',true),($2,'current','2 Fixture Street, Phường Fixture A2, Tỉnh Fixture A',$6,$9,'2026-02-01',true),($3,'current','3 Fixture Street, Phường Fixture B, Tỉnh Fixture B',$7,$10,'2026-02-01',true),($4,'current','6 Fixture Street, Phường Fixture A, Tỉnh Fixture A',$5,$8,'2025-08-01',true)",
    [
      pA1,
      pA2,
      pB1,
      archivedProperty,
      provinceAFirst,
      provinceASecond,
      provinceB,
      communeA,
      communeA2,
      communeB,
    ],
  );
  // A preserved legacy address keeps its untouched district-bearing source text, and the
  // unresolved current candidate keeps a province reference that must not count as verified
  // geography (a partial or unverified transition is never substituted automatically).
  await db.query(
    "insert into public.property_addresses(property_id,format,address_text,province_text,district_text,commune_text,is_primary) values($1,'legacy','12 Lý Thường Kiệt, Phường 14, Quận 10, Thành phố Hồ Chí Minh',$2,'Quận 10','Phường 14',true)",
    [legacyOnly, legacyRawProvince],
  );
  await db.query(
    "insert into public.property_addresses(property_id,format,address_text,province_unit_id,commune_unit_id,mapping_status,is_primary) values($1,'current','5 Fixture Street, Phường Fixture A2, Tỉnh Fixture A',$2,$3,'candidate',true)",
    [candidate, provinceASecond, communeA2],
  );
  await db.query(
    "insert into public.admin_unit_versions(id,official_code,name_vi,unit_level,valid_from,valid_to,source_url) values($1,$2,$3,'province','2025-01-04','2025-07-01','https://example.test/legacy-catalog')",
    [legacyProvince, provinceACode, legacyProvinceName],
  );
  await db.query(
    "insert into public.admin_unit_versions(id,official_code,name_vi,unit_level,parent_id,valid_from,valid_to,source_url) values($1,'TST-LD',$2,'district',$3,'2025-01-04','2025-07-01','https://example.test/legacy-catalog'),($4,'TST-LC',$5,'commune',$1,'2025-01-04','2025-07-01','https://example.test/legacy-catalog')",
    [
      legacyDistrict,
      legacyDistrictName,
      legacyProvince,
      legacyCommune,
      legacyCommuneName,
    ],
  );
  // The dangerous legacy state: the three-tier unit ids are recorded on the legacy row, with no
  // current address at all. The row also carries a verification designation, which the current
  // address guard refuses, so it is written with that guard suspended: it stands for a row an
  // import, a data fix or a pre-guard write path could leave behind. Only the reporting join's
  // format='current' term keeps such a legacy province out of the verified report, which is what
  // gives this regression teeth.
  await db.query(
    'alter table public.property_addresses disable trigger address_guard',
  );
  try {
    await db.query(
      "insert into public.property_addresses(property_id,format,address_text,province_text,district_text,commune_text,province_unit_id,district_unit_id,commune_unit_id,mapping_status,verification_method,verified_by,verified_at,source_url,effective_on,mapping_evidence,is_primary) values($1,'legacy','14 Lý Thường Kiệt, Phường Fixture Legacy, Quận Fixture Legacy, Tỉnh Fixture Legacy',$2,$3,$8,$4,$5,$6,'verified','document',$7,now(),'https://example.test/legacy-evidence','2025-03-01','Legacy source row kept as written by the historical sheet',true)",
      [
        legacyLocated,
        legacyProvinceText,
        legacyDistrictText,
        legacyProvince,
        legacyDistrict,
        legacyCommune,
        employees[0],
        legacyCommuneText,
      ],
    );
  } finally {
    await db.query(
      'alter table public.property_addresses enable trigger address_guard',
    );
  }

  const addressRevision = async (id) =>
    (
      await db.query(
        'select revision from public.property_addresses where id=$1',
        [id],
      )
    ).rows[0].revision;
  const primaryCurrentAddress = async (property) =>
    (
      await db.query(
        "select id from public.property_addresses where property_id=$1 and format='current' and is_primary",
        [property],
      )
    ).rows[0].id;
  const propertyRevision = async (id) =>
    (await db.query('select revision from public.properties where id=$1', [id]))
      .rows[0].revision;
  // The authorized mapping designation: manager/admin only, valid province→commune version
  // hierarchy, effective date inside both validity windows and property-level evidence.
  const map = async (property, changes) => {
    const address = await primaryCurrentAddress(property);
    await db.query('select public.maintain_property($1,$2,$3,$4,$5,$6)', [
      property,
      'mapping',
      address,
      await addressRevision(address),
      changes,
      await propertyRevision(property),
    ]);
  };
  const verifiedMapping = (province, commune, effectiveOn) => ({
    province_unit_id: province,
    commune_unit_id: commune,
    mapping_status: 'verified',
    verification_method: 'manual',
    source_url: 'https://example.test/evidence',
    effective_on: effectiveOn,
    mapping_evidence:
      'Property boundary and documents checked against official evidence',
  });

  await asUser(2);
  await map(pA1, verifiedMapping(provinceAFirst, communeA, '2025-08-01'));
  await map(pA2, verifiedMapping(provinceASecond, communeA2, '2026-02-01'));
  await map(pB1, verifiedMapping(provinceB, communeB, '2026-02-01'));
  await map(
    archivedProperty,
    verifiedMapping(provinceAFirst, communeA, '2025-08-01'),
  );

  // Committed owner-contact units on two fixed Vietnam days. Every other harness contract uses
  // now()-based days or the #30/#31 fixture dates, so these days isolate this report.
  await asOwner();
  const at = (day) => `${day} 12:00:00+07`;
  const record = async (employee, property, day, repeats = 1) => {
    for (let index = 0; index < repeats; index++)
      await db.query(
        "insert into public.activity_events(employee_id,property_id,kind,idempotency_key,occurred_at) values($1,$2,'owner_contact_access',$3,$4)",
        [employee, property, randomUUID(), at(day)],
      );
  };
  // Same day: employee 0 discloses one property twice and employee 1 discloses it once, plus
  // one second-province unit and two units whose province cannot be resolved.
  await record(employees[0], pA1, sameDay, 2);
  await record(employees[1], pA1, sameDay);
  await record(employees[0], pB1, sameDay);
  await record(employees[0], legacyOnly, sameDay);
  await record(employees[1], candidate, sameDay);
  // Two owner-contact units on the property whose only address is legacy geography.
  await record(employees[0], legacyLocated, legacyDay);
  await record(employees[1], legacyLocated, legacyDay);
  // A later Vietnam day: one repeated property counts again, one second property of the same
  // province and one property that is archived later.
  await record(employees[0], pA1, laterDay);
  await record(employees[0], pA2, laterDay);
  await record(employees[0], archivedProperty, laterDay);
  // A page view and a retained legacy visit kind never enter the owner-contact metric.
  await db.query(
    "insert into public.activity_events(employee_id,property_id,kind,idempotency_key,occurred_at) values($1,$2,'page_view',$3,$4)",
    [employees[0], pA1, randomUUID(), at(sameDay)],
  );
  await db.query(
    "insert into public.activity_events(employee_id,property_id,kind,visit_status,idempotency_key,occurred_at) values($1,$2,'site_visit','pending',$3,$4)",
    [employees[0], pA1, randomUUID(), at(sameDay)],
  );

  const read = async (from, to) =>
    (
      await db.query(
        'select province_unit_id,official_code,province_name,owner_contact_properties from public.company_province_owner_contact_activity($1,$2)',
        [from, to],
      )
    ).rows;
  const shape = (rows) =>
    rows.map((row) => ({
      id: row.province_unit_id,
      code: row.official_code,
      name: row.province_name,
      count: Number(row.owner_contact_properties),
    }));
  const pick = (rows, code) =>
    shape(rows).find((row) => row.code === code) ?? null;
  const total = (rows) => shape(rows).reduce((sum, row) => sum + row.count, 0);
  const companyTotal = async (from, to) =>
    Number(
      (
        await db.query(
          'select coalesce(sum(owner_contact_properties),0)::bigint as total from public.company_employee_daily_activity($1,$2)',
          [from, to],
        )
      ).rows[0].total,
    );

  await asUser(2);
  const sameDayRows = await read(sameDay, sameDay);
  await check(
    'province activity counts employee-property-Vietnam-day units, not page views, retained visits or raw reveal counts',
    () =>
      assert.deepEqual(shape(sameDayRows), [
        {
          id: provinceASecond,
          code: provinceACode,
          name: provinceARevisedName,
          count: 2,
        },
        { id: null, code: null, name: null, count: 2 },
        {
          id: provinceB,
          code: 'TST-PB',
          name: provinceBName,
          count: 1,
        },
      ]),
  );
  await check(
    'two employees on one property and Vietnam day contribute two while repeated disclosures contribute one',
    async () => {
      const committed = (
        await db.query(
          "select count(*)::int as events,count(distinct employee_id)::int as employees from public.activity_events where kind='owner_contact_access' and property_id=$1 and business_day=$2",
          [pA1, sameDay],
        )
      ).rows[0];
      assert.equal(committed.events, 3);
      assert.equal(committed.employees, 2);
      assert.equal(pick(sameDayRows, provinceACode).count, 2);
    },
  );
  await check(
    'a later Vietnam day contributes again while an event-free day reports an explicit zero group',
    async () => {
      assert.deepEqual(shape(await read(laterDay, laterDay)), [
        {
          id: provinceASecond,
          code: provinceACode,
          name: provinceARevisedName,
          count: 3,
        },
        { id: null, code: null, name: null, count: 0 },
      ]);
      assert.deepEqual(shape(await read(quietDay, quietDay)), [
        { id: null, code: null, name: null, count: 0 },
      ]);
    },
  );
  await check(
    'one official province code stays one group across catalog versions and uses the canonical official name',
    async () => {
      const provinceRows = shape(await read(sameDay, laterDay)).filter(
        (row) => row.code === provinceACode,
      );
      assert.equal(provinceRows.length, 1);
      assert.equal(provinceRows[0].name, provinceARevisedName);
      assert.equal(provinceRows[0].id, provinceASecond);
    },
  );
  await check(
    'unresolved and unverified candidate properties stay in the separate Unverified group without raw legacy text',
    async () => {
      const rows = shape(await read(sameDay, sameDay));
      const unverified = rows.filter((row) => row.code === null);
      assert.equal(unverified.length, 1);
      assert.equal(unverified[0].count, 2);
      assert.ok(
        !rows.some((row) => row.name === legacyRawProvince),
        'raw legacy province text must never become a group',
      );
    },
  );
  await check(
    'legacy unit ids on a verified legacy address stay in the Unverified group and keep the company total',
    async () => {
      assert.deepEqual(shape(await read(legacyDay, legacyDay)), [
        { id: null, code: null, name: null, count: 2 },
      ]);
      assert.equal(await companyTotal(legacyDay, legacyDay), 2);
    },
  );
  await check(
    'area analytics reports the legacy province text and district beside the unverified current commune',
    async () => {
      const rows = (
        await db.query(
          'select province_label,current_commune_id,current_commune_label,legacy_district_label,inventory_count from public.v_admin_inventory_by_area where province_label=$1',
          [legacyProvinceText],
        )
      ).rows.map((row) => ({
        ...row,
        inventory_count: Number(row.inventory_count),
      }));
      assert.deepEqual(rows, [
        {
          province_label: legacyProvinceText,
          current_commune_id: null,
          current_commune_label: 'Chưa xác minh địa chỉ mới',
          legacy_district_label: legacyDistrictText,
          inventory_count: 1,
        },
      ]);
    },
  );
  await check(
    'province and Unverified totals equal the same-period company employee activity sum',
    async () => {
      for (const [from, to] of [
        [sameDay, sameDay],
        [laterDay, laterDay],
        [sameDay, laterDay],
        [quietDay, quietDay],
      ])
        assert.equal(
          total(await read(from, to)),
          await companyTotal(from, to),
          `${from}..${to} must reconcile with the company report`,
        );
    },
  );
  await check(
    'the report is sorted highest first and is deterministic',
    async () => {
      const rows = await read(sameDay, laterDay);
      const counts = rows.map((row) => Number(row.owner_contact_properties));
      assert.deepEqual(
        counts,
        [...counts].sort((a, b) => b - a),
      );
      assert.deepEqual(shape(rows), shape(await read(sameDay, laterDay)));
      assert.deepEqual(shape(rows), [
        {
          id: provinceASecond,
          code: provinceACode,
          name: provinceARevisedName,
          count: 5,
        },
        { id: null, code: null, name: null, count: 2 },
        {
          id: provinceB,
          code: 'TST-PB',
          name: provinceBName,
          count: 1,
        },
      ]);
      assert.equal(total(rows), 8);
    },
  );

  await check(
    'an authorized address correction regroups only the affected counts and keeps the company total',
    async () => {
      const before = total(await read(sameDay, laterDay));
      await map(pA1, verifiedMapping(provinceB, communeB, '2025-08-01'));
      assert.deepEqual(shape(await read(sameDay, laterDay)), [
        {
          id: provinceB,
          code: 'TST-PB',
          name: provinceBName,
          count: 4,
        },
        {
          id: provinceASecond,
          code: provinceACode,
          name: provinceARevisedName,
          count: 2,
        },
        { id: null, code: null, name: null, count: 2 },
      ]);
      assert.equal(total(await read(sameDay, laterDay)), before);
      assert.equal(await companyTotal(sameDay, laterDay), before);
      // The corrected property's earlier unit moved too: no event-time geography snapshot.
      assert.deepEqual(shape(await read(laterDay, laterDay)), [
        {
          id: provinceASecond,
          code: provinceACode,
          name: provinceARevisedName,
          count: 2,
        },
        {
          id: provinceB,
          code: 'TST-PB',
          name: provinceBName,
          count: 1,
        },
        { id: null, code: null, name: null, count: 0 },
      ]);
    },
  );
  await check(
    'an invalidated mapping moves the affected units to Unverified and keeps the company total',
    async () => {
      const before = total(await read(sameDay, laterDay));
      await map(pA1, { mapping_status: 'candidate' });
      assert.deepEqual(shape(await read(sameDay, laterDay)), [
        { id: null, code: null, name: null, count: 5 },
        {
          id: provinceASecond,
          code: provinceACode,
          name: provinceARevisedName,
          count: 2,
        },
        {
          id: provinceB,
          code: 'TST-PB',
          name: provinceBName,
          count: 1,
        },
      ]);
      assert.equal(total(await read(sameDay, laterDay)), before);
      assert.equal(await companyTotal(sameDay, laterDay), before);
    },
  );
  await check(
    're-verifying the corrected property restores its province group',
    async () => {
      await map(pA1, verifiedMapping(provinceAFirst, communeA, '2025-08-01'));
      assert.deepEqual(shape(await read(sameDay, laterDay)), [
        {
          id: provinceASecond,
          code: provinceACode,
          name: provinceARevisedName,
          count: 5,
        },
        { id: null, code: null, name: null, count: 2 },
        {
          id: provinceB,
          code: 'TST-PB',
          name: provinceBName,
          count: 1,
        },
      ]);
    },
  );

  await asOwner();
  await db.query('update public.properties set archived_at=now() where id=$1', [
    archivedProperty,
  ]);
  await asUser(2);
  await check(
    'archiving a property keeps its earlier committed owner-contact credit',
    async () =>
      assert.deepEqual(shape(await read(laterDay, laterDay)), [
        {
          id: provinceASecond,
          code: provinceACode,
          name: provinceARevisedName,
          count: 3,
        },
        { id: null, code: null, name: null, count: 0 },
      ]),
  );
  await check(
    'invalid ranges are rejected instead of reported as an empty table',
    async () => {
      await fails(
        'select * from public.company_province_owner_contact_activity($1,$2)',
        [laterDay, sameDay],
        '22023',
      );
      await fails(
        'select * from public.company_province_owner_contact_activity($1,$2)',
        ['2025-01-01', '2026-10-01'],
        '22023',
      );
      await fails(
        'select * from public.company_province_owner_contact_activity($1,$2)',
        [null, sameDay],
        '22023',
      );
    },
  );

  await asUser(3);
  await check('admin province reporting allowed', async () =>
    assert.equal(total(await read(sameDay, laterDay)), 8),
  );
  await asUser(null);
  await check('anonymous province reporting denied', () =>
    fails(
      'select * from public.company_province_owner_contact_activity($1,$2)',
      [sameDay, laterDay],
      '42501',
    ),
  );
  await asUser(4);
  await check('inactive identity province reporting denied', () =>
    fails(
      'select * from public.company_province_owner_contact_activity($1,$2)',
      [sameDay, laterDay],
      '42501',
    ),
  );
  await asUser(0);
  await check('sales employee province reporting denied', () =>
    fails(
      'select * from public.company_province_owner_contact_activity($1,$2)',
      [sameDay, laterDay],
      '42501',
    ),
  );
  await asUser(5);
  await check('staff employee province reporting denied', () =>
    fails(
      'select * from public.company_province_owner_contact_activity($1,$2)',
      [sameDay, laterDay],
      '42501',
    ),
  );
  await asUser(0);
  await check(
    'an ordinary employee cannot reach the same read through the private definer',
    () =>
      fails(
        'select * from private.company_province_owner_contact_activity($1,$2)',
        [sameDay, laterDay],
        '42501',
      ),
  );
  await check('direct activity mutation stays denied', () =>
    fails(
      "insert into public.activity_events(employee_id,property_id,kind,idempotency_key) values($1,$2,'owner_contact_access',$3)",
      [employees[0], pA1, randomUUID()],
      '42501',
    ),
  );

  await asUser(2);
  await asOwner();
  await db.query("update public.employees set role='sales' where id=$1", [
    employees[2],
  ]);
  await asUser(2);
  await check(
    'a role downgrade removes province reporting authority on the next request',
    () =>
      fails(
        'select * from public.company_province_owner_contact_activity($1,$2)',
        [sameDay, laterDay],
        '42501',
      ),
  );
  await asOwner();
  await db.query("update public.employees set role='manager' where id=$1", [
    employees[2],
  ]);
  await asUser(2);
  await check('restoring the manager role restores the report read', async () =>
    assert.equal(total(await read(sameDay, laterDay)), 8),
  );
  await asOwner();
  await db.query('update public.employees set is_active=false where id=$1', [
    employees[2],
  ]);
  await asUser(2);
  await check('deactivation removes province reporting authority', () =>
    fails(
      'select * from public.company_province_owner_contact_activity($1,$2)',
      [sameDay, laterDay],
      '42501',
    ),
  );
  await asOwner();
  await db.query('update public.employees set is_active=true where id=$1', [
    employees[2],
  ]);

  // A deactivated employee's committed units leave this report and the company report
  // together, so the two reads keep reconciling instead of silently disagreeing.
  await asOwner();
  await db.query('update public.employees set is_active=false where id=$1', [
    employees[1],
  ]);
  await asUser(2);
  await check(
    'a deactivated employee leaves province activity and the company report together',
    async () => {
      assert.equal(total(await read(sameDay, laterDay)), 6);
      assert.equal(await companyTotal(sameDay, laterDay), 6);
      assert.equal(pick(await read(sameDay, sameDay), provinceACode).count, 1);
      assert.equal(
        shape(await read(sameDay, sameDay)).find((row) => row.code === null)
          .count,
        1,
      );
    },
  );
  await asOwner();
  await db.query('update public.employees set is_active=true where id=$1', [
    employees[1],
  ]);
  await asUser(2);
  await check(
    'reactivating the employee restores the complete report',
    async () => assert.equal(total(await read(sameDay, laterDay)), 8),
  );
}
