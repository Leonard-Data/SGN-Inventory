import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// The official old -> new administrative unit crosswalk seeded by
// 20261021080934_admin_unit_crosswalks_official_ingest.sql from the pinned
// sunshine-tech/VietnamProvinces conversion table, the source_attested marker it
// adds, and the write boundary 20261021080935_admin_unit_crosswalks_write_boundary.sql
// closes. It proves the seeded rows, their generation boundary, the derived
// whole/partial/rename relation, the named coverage gaps and the delivered guard
// path: a manager can verify a current address against a whole crosswalk row and
// is refused through a partial one. Real hosted Supabase, the HTTP route and
// browser acceptance stay a staging gate.
const SOURCE_URL =
  'https://github.com/sunshine-tech/VietnamProvinces/blob/4cc4038d0e89bd8affbda864119c1ab1e0360523/dev/seed-data/2025-07/BangChuyendoiĐVHCmoi_cu_khong_merge.csv';
const INGEST_SUFFIX = '_admin_unit_crosswalks_official_ingest.sql';
const LEGACY_FROM = '2025-01-04';
const EFFECTIVE_ON = '2025-07-01';
// The 28 legacy wards the conversion table leaves without an accepted row.
const UNCOVERED = [
  '01651',
  '02482',
  '03751',
  '03898',
  '03913',
  '03988',
  '03991',
  '04003',
  '04060',
  '07693',
  '07732',
  '07744',
  '16387',
  '16411',
  '18448',
  '20176',
  '20674',
  '25102',
  '25174',
  '25177',
  '25186',
  '26935',
  '26959',
  '27067',
  '27217',
  '27223',
  '27361',
  '27379',
];
// The five island districts that became one đặc khu each.
const ISLAND_DISTRICTS = {
  318: '11948',
  471: '19742',
  498: '20333',
  536: '21548',
  755: '26732',
};
const MAINTAIN_SQL =
  'select public.maintain_property($1,$2,$3,$4,$5,(select revision from public.properties where id=$1)) as id';

export async function legacyCrosswalkContract({
  db,
  asUser,
  check,
  employees,
  root,
}) {
  const asSystem = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
  const count = async (sql, params = []) =>
    Number((await rows(sql, params))[0].n);
  const refuse = async (sql, params, code, pattern) => {
    let error;
    try {
      await db.query(sql, params);
    } catch (caught) {
      error = caught;
    }
    assert.ok(error, 'expected the database to refuse the write');
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
  };
  const unitId = async (level, code, validFrom) =>
    (
      await rows(
        'select id from public.admin_unit_versions where unit_level=$1 and official_code=$2 and valid_from=$3',
        [level, code, validFrom],
      )
    )[0].id;

  await check(
    'the crosswalk seeds every accepted official row once',
    async () => {
      assert.equal(
        await count(
          'select count(*)::int as n from public.admin_unit_crosswalks',
        ),
        10622,
      );
      const byLevel = Object.fromEntries(
        (
          await rows(
            'select f.unit_level,count(*)::int as n from public.admin_unit_crosswalks x join public.admin_unit_versions f on f.id=x.from_unit_id group by f.unit_level',
          )
        ).map((row) => [row.unit_level, row.n]),
      );
      assert.deepEqual(byLevel, { commune: 10554, district: 5, province: 63 });
    },
  );

  await check(
    'every crosswalk row cites the pinned conversion table and carries the attestation marker',
    async () => {
      assert.deepEqual(
        await rows(
          'select distinct source_url from public.admin_unit_crosswalks',
        ),
        [{ source_url: SOURCE_URL }],
      );
      assert.equal(
        await count(
          `select count(*)::int as n from public.admin_unit_crosswalks where source_attested and verified_by is null`,
        ),
        10622,
      );
      const column = (
        await rows(
          "select is_nullable,column_default from information_schema.columns where table_name='admin_unit_crosswalks' and column_name='source_attested'",
        )
      )[0];
      assert.deepEqual(column, { is_nullable: 'NO', column_default: 'false' });
    },
  );

  await check(
    'every row joins a closed legacy unit to a current unit opening the same day',
    async () => {
      assert.equal(
        await count(
          `select count(*)::int as n from public.admin_unit_crosswalks x
           join public.admin_unit_versions f on f.id=x.from_unit_id
           join public.admin_unit_versions t on t.id=x.to_unit_id
           where x.effective_on<>date '${EFFECTIVE_ON}' or t.valid_from<>x.effective_on
             or f.valid_to is distinct from date '${EFFECTIVE_ON}'
             or f.valid_from<>date '${LEGACY_FROM}' or f.id=x.to_unit_id`,
        ),
        0,
      );
      // A province row maps province -> province; every other row maps onto a commune.
      assert.deepEqual(
        await rows(
          `select f.unit_level as from_level,t.unit_level as to_level,count(*)::int as n
           from public.admin_unit_crosswalks x
           join public.admin_unit_versions f on f.id=x.from_unit_id
           join public.admin_unit_versions t on t.id=x.to_unit_id
           group by 1,2 order by 1,2`,
        ),
        [
          { from_level: 'commune', to_level: 'commune', n: 10554 },
          { from_level: 'district', to_level: 'commune', n: 5 },
          { from_level: 'province', to_level: 'province', n: 63 },
        ],
      );
      // Every current-sides unit is the one the current catalog seeds.
      assert.equal(
        await count(
          `select count(*)::int as n from public.admin_unit_crosswalks x
           join public.admin_unit_versions t on t.id=x.to_unit_id
           where t.source_url not like 'https://github.com/thanglequoc/%'`,
        ),
        0,
      );
    },
  );

  await check(
    'the relation over legacy wards is 9578 whole, 441 partial and 4 rename',
    async () => {
      assert.deepEqual(
        await rows(
          `select x.relation,count(distinct x.from_unit_id)::int as n
           from public.admin_unit_crosswalks x
           join public.admin_unit_versions f on f.id=x.from_unit_id and f.unit_level='commune'
           group by x.relation order by x.relation`,
        ),
        [
          { relation: 'partial', n: 441 },
          { relation: 'rename', n: 4 },
          { relation: 'whole', n: 9578 },
        ],
      );
    },
  );

  await check(
    'a single successor is not automatically whole, and a whole row is a unit one',
    async () => {
      assert.deepEqual(
        await rows(
          `select f.official_code,x.relation,t.official_code as to_code,x.resolution_notes
           from public.admin_unit_crosswalks x
           join public.admin_unit_versions f on f.id=x.from_unit_id
           join public.admin_unit_versions t on t.id=x.to_unit_id
           where f.unit_level='commune' and f.official_code='00556'`,
        ),
        [
          {
            official_code: '00556',
            relation: 'partial',
            to_code: '00541',
            resolution_notes: 'Nhập một phần diện tích',
          },
        ],
      );
      // A whole transition covers the unit, so it is exactly one successor row;
      // a partial one may split into several.
      assert.equal(
        await count(
          `select count(*)::int as n from (
             select x.from_unit_id from public.admin_unit_crosswalks x
             join public.admin_unit_versions f on f.id=x.from_unit_id and f.unit_level='commune'
             group by x.from_unit_id having bool_or(x.relation='whole') and count(*)>1
           ) split_whole_rows`,
        ),
        0,
      );
      assert.equal(
        await count(
          `select count(*)::int as n from (
             select x.from_unit_id from public.admin_unit_crosswalks x
             join public.admin_unit_versions f on f.id=x.from_unit_id and f.unit_level='commune'
             group by x.from_unit_id having count(*)>1 and bool_or(x.relation<>'partial')
           ) split_non_partial`,
        ),
        0,
      );
    },
  );

  await check(
    'coverage reaches 10023 legacy wards and names the 28 it cannot',
    async () => {
      const mapped = await rows(
        `select distinct f.official_code from public.admin_unit_crosswalks x
         join public.admin_unit_versions f on f.id=x.from_unit_id
         where f.unit_level='commune' and f.valid_to=date '${EFFECTIVE_ON}'`,
      );
      const legacyWards = await rows(
        `select official_code from public.admin_unit_versions where unit_level='commune' and valid_to=date '${EFFECTIVE_ON}'`,
      );
      assert.equal(legacyWards.length, 10051);
      assert.equal(mapped.length, 10023);
      const names = new Set(mapped.map((row) => row.official_code));
      assert.deepEqual(
        legacyWards
          .map((row) => row.official_code)
          .filter((code) => !names.has(code))
          .sort(),
        UNCOVERED,
      );
      // Each legacy province carries exactly one row; five districts carry one.
      assert.equal(
        await count(
          `select count(*)::int as n from public.admin_unit_versions f
           where f.unit_level='province' and f.valid_to=date '${EFFECTIVE_ON}'
             and (select count(*) from public.admin_unit_crosswalks x where x.from_unit_id=f.id)<>1`,
        ),
        0,
      );
      assert.equal(
        await count(
          `select count(*)::int as n from public.admin_unit_versions f
           where f.unit_level='district' and f.valid_to=date '${EFFECTIVE_ON}'
             and exists (select 1 from public.admin_unit_crosswalks x where x.from_unit_id=f.id)`,
        ),
        5,
      );
    },
  );

  await check(
    'the five island districts map whole to their đặc khu and a tidal area is not a unit',
    async () => {
      const island = await rows(
        `select f.official_code as from_code,t.official_code as to_code,x.relation,x.resolution_notes
         from public.admin_unit_crosswalks x
         join public.admin_unit_versions f on f.id=x.from_unit_id and f.unit_level='district'
         join public.admin_unit_versions t on t.id=x.to_unit_id`,
      );
      assert.deepEqual(
        Object.fromEntries(island.map((row) => [row.from_code, row.to_code])),
        ISLAND_DISTRICTS,
      );
      assert.deepEqual(
        [...new Set(island.map((row) => row.relation))],
        ['whole'],
      );
      // The source words each of those as "Sắp xếp toàn bộ huyện X thành đặc khu X",
      // so the note is preserved rather than the relation being inferred.
      for (const row of island)
        assert.match(
          row.resolution_notes,
          /^Sắp xếp toàn bộ huyện .+ thành đặc khu /,
        );
      assert.equal(
        await count(
          `select count(*)::int as n from public.admin_unit_crosswalks x
           join public.admin_unit_versions f on f.id=x.from_unit_id
           where f.unit_level='district' and f.official_code='376'`,
        ),
        0,
      );
    },
  );

  await check(
    'the notes the source does not state plainly are preserved as text',
    async () => {
      assert.equal(
        await count(
          'select count(*)::int as n from public.admin_unit_crosswalks where resolution_notes is not null',
        ),
        157,
      );
      assert.deepEqual(
        await rows(
          `select distinct resolution_notes from public.admin_unit_crosswalks
           where resolution_notes like 'Sắp xếp toàn bộ xã%' or resolution_notes like 'Phần còn lại%'`,
        ),
        [
          {
            resolution_notes:
              'Phần còn lại sau khi tách một phần vào xã Canh Vinh',
          },
          {
            resolution_notes:
              'Sắp xếp toàn bộ xã Thổ Châu thành đặc khu Thổ Châu',
          },
        ],
      );
    },
  );

  // Delivered guard path: a legacy address plus its current counterpart, verified
  // by a manager through the crosswalk the migration seeded.
  const legacyProvince = await unitId('province', '01', LEGACY_FROM);
  const legacyDistrict = await unitId('district', '001', LEGACY_FROM);
  const legacyGiaLam = await unitId('district', '018', LEGACY_FROM);
  const hanoi = await unitId('province', '01', EFFECTIVE_ON);
  const baDinh = await unitId('commune', '00004', EFFECTIVE_ON);
  const ngocHa = await unitId('commune', '00008', EFFECTIVE_ON);
  const wholeProperty = '2e000000-0000-4000-8000-000000000001';
  const wholeLegacyAddress = '2f000000-0000-4000-8000-000000000001';
  const wholeAddress = '2f000000-0000-4000-8000-000000000002';
  const partialProperty = '2e000000-0000-4000-8000-000000000002';
  const partialLegacyAddress = '2f000000-0000-4000-8000-000000000003';
  const partialAddress = '2f000000-0000-4000-8000-000000000004';
  const wrongTargetAddress = '2f000000-0000-4000-8000-000000000005';
  const maintained = {
    province_unit_id: hanoi,
    commune_unit_id: baDinh,
    mapping_status: 'verified',
    verification_method: 'official_whole_mapping',
    source_url: 'https://example.test/crosswalk-evidence',
    effective_on: '2026-10-10',
    mapping_evidence:
      'Lease and boundary record for the legacy ward at the merge date',
  };
  const addressRevision = async (id) =>
    (
      await db.query(
        'select revision from public.property_addresses where id=$1',
        [id],
      )
    ).rows[0].revision;

  await asSystem();
  await db.query(
    "insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-XW-1','sale','available',$3),($2,'SGN-XW-2','sale','available',$3)",
    [wholeProperty, partialProperty, employees[0]],
  );
  await db.query(
    "insert into public.property_addresses(id,property_id,format,address_text,province_unit_id,district_unit_id,commune_unit_id) values($1,$2,'legacy','Số 1 phố Quán Thánh, Ba Đình, Hà Nội',$3,$4,$5),($6,$7,'legacy','Thôn Đặng Xá, Gia Lâm, Hà Nội',$3,$8,$9)",
    [
      wholeLegacyAddress,
      wholeProperty,
      legacyProvince,
      legacyDistrict,
      await unitId('commune', '00013', LEGACY_FROM),
      partialLegacyAddress,
      partialProperty,
      legacyGiaLam,
      await unitId('commune', '00556', LEGACY_FROM),
    ],
  );
  await db.query(
    "insert into public.property_addresses(id,property_id,format,address_text,mapping_status,is_primary) values($1,$2,'current','Số 1 phố Ba Đình','unresolved',true),($3,$4,'current','Thôn Phù Đổng','unresolved',true),($5,$6,'current','Số 2 phố Ngọc Hà','unresolved',false)",
    [
      wholeAddress,
      wholeProperty,
      partialAddress,
      partialProperty,
      wrongTargetAddress,
      wholeProperty,
    ],
  );
  await asUser(2);

  await check(
    'a manager verifies a whole-mapped legacy ward with official_whole_mapping',
    async () => {
      await db.query(MAINTAIN_SQL, [
        wholeProperty,
        'mapping',
        wholeAddress,
        await addressRevision(wholeAddress),
        maintained,
      ]);
      assert.deepEqual(
        await rows(
          'select mapping_status,verification_method,verified_by,commune_unit_id from public.property_addresses where id=$1',
          [wholeAddress],
        ),
        [
          {
            mapping_status: 'verified',
            verification_method: 'official_whole_mapping',
            verified_by: employees[2],
            commune_unit_id: baDinh,
          },
        ],
      );
    },
  );

  await check(
    'a whole crosswalk to another commune does not verify this one',
    async () =>
      refuse(
        MAINTAIN_SQL,
        [
          wholeProperty,
          'mapping',
          wrongTargetAddress,
          await addressRevision(wrongTargetAddress),
          { ...maintained, commune_unit_id: ngocHa },
        ],
        '23514',
        /whole mapping evidence required; partial transitions unresolved/,
      ),
  );

  await check(
    'a partial transition never satisfies the whole-mapping guard',
    async () =>
      refuse(
        MAINTAIN_SQL,
        [
          partialProperty,
          'mapping',
          partialAddress,
          await addressRevision(partialAddress),
          {
            ...maintained,
            commune_unit_id: await unitId('commune', '00541', EFFECTIVE_ON),
          },
        ],
        '23514',
        /whole mapping evidence required; partial transitions unresolved/,
      ),
  );

  await asUser(3);
  await check(
    'an admin cannot insert or edit a crosswalk row from the client',
    async () => {
      await refuse(
        "insert into public.admin_unit_crosswalks(from_unit_id,to_unit_id,relation,effective_on,source_url,source_attested) values($1,$2,'whole',date '2025-07-01','https://example.test/forged',true)",
        [legacyDistrict, baDinh],
        '42501',
      );
      await refuse(
        "update public.admin_unit_crosswalks set relation='whole',source_attested=true where id=(select id from public.admin_unit_crosswalks limit 1)",
        [],
        '42501',
      );
      await refuse('delete from public.admin_unit_crosswalks', [], '42501');
      assert.ok(
        (await rows('select id from public.admin_unit_crosswalks limit 1'))
          .length,
      );
      assert.equal(
        await count(
          'select count(*)::int as n from public.admin_unit_crosswalks where source_url<>$1',
          [SOURCE_URL],
        ),
        0,
      );
    },
  );

  await asSystem();
  await check(
    're-applying the ingest migration converges without duplicating or re-keying rows',
    async () => {
      const before = await rows(
        'select count(*)::int as n,count(distinct id)::int as ids from public.admin_unit_crosswalks',
      );
      const sample = await rows(
        "select id,from_unit_id,to_unit_id,relation from public.admin_unit_crosswalks where effective_on=date '2025-07-01' order by from_unit_id,to_unit_id limit 5",
      );
      const file = (
        await fs.readdir(path.join(root, 'supabase/migrations'))
      ).find((name) => name.endsWith(INGEST_SUFFIX));
      await db.exec(
        await fs.readFile(path.join(root, 'supabase/migrations', file), 'utf8'),
      );
      assert.deepEqual(
        await rows(
          'select count(*)::int as n,count(distinct id)::int as ids from public.admin_unit_crosswalks',
        ),
        before,
      );
      assert.deepEqual(
        await rows(
          'select id,from_unit_id,to_unit_id,relation from public.admin_unit_crosswalks order by from_unit_id,to_unit_id limit 5',
        ),
        sample,
      );
      assert.equal(
        await count(
          'select count(*)::int as n from public.admin_unit_crosswalks where not source_attested or verified_by is not null',
        ),
        0,
      );
    },
  );

  await asSystem();
}
