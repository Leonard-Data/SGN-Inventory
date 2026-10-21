import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_CATALOG_START } from '../src/features/property-maintenance/units.ts';

// Vietnamese province/city and ward/commune reference catalog seeded by
// 20261014075435_vietnamese_admin_units_reference.sql from
// thanglequoc/vietnamese-provinces-database: pre-2026 names (upstream v3.0.2)
// for the 2025-07-01 baseline window, and the v5.2.0 names for the 2026-04-30
// Đồng Nai, 2026-09-01 Quảng Ninh and 2026-09-20 Bắc Ninh windows.
// 20261021060602_legacy_admin_units_reference.sql adds the pre-2025 three-tier
// province/district/ward snapshot from sunshine-tech/VietnamProvinces on the
// closed [2025-01-04, 2025-07-01) window.
// It proves the seeded codes, hierarchy, half-open validity windows and counts,
// the idempotent re-application, and the delivered address paths that consume
// the catalog (the admin-unit picker query, the verified-mapping guard and the
// per-date area analytics label). Real hosted Supabase, the HTTP route and
// browser acceptance stay a staging gate.
const SOURCE_URL =
  'https://github.com/thanglequoc/vietnamese-provinces-database/blob/v5.2.0/postgresql/postgres_ImportData_vn_units.sql';
const MIGRATION_SUFFIX = '_vietnamese_admin_units_reference.sql';
const LEGACY_SOURCE_URL =
  'https://github.com/sunshine-tech/VietnamProvinces/blob/4cc4038d0e89bd8affbda864119c1ab1e0360523/dev/seed-data/Pre-2025-07/Xa_2025-01-04.csv';
const LEGACY_MIGRATION_SUFFIX = '_legacy_admin_units_reference.sql';
const LEGACY_FROM = '2025-01-04';
const LEGACY_TO = '2025-07-01';
// The day the date-aware catalog read was accepted, standing in for an absent `on`.
const CURRENT_READ_DAY = '2026-10-21';
// Pre-2025 province codes reused for a different current province, which is why
// a unit is keyed by (unit_level, official_code, valid_from) and never by code.
const REUSED_PROVINCE_CODES = {
  15: ['Tỉnh Yên Bái', 'Tỉnh Lào Cai'],
  24: ['Tỉnh Bắc Giang', 'Tỉnh Bắc Ninh'],
  44: ['Tỉnh Quảng Bình', 'Tỉnh Quảng Trị'],
  52: ['Tỉnh Bình Định', 'Tỉnh Gia Lai'],
  80: ['Tỉnh Long An', 'Tỉnh Tây Ninh'],
  82: ['Tỉnh Tiền Giang', 'Tỉnh Đồng Tháp'],
  91: ['Tỉnh Kiên Giang', 'Tỉnh An Giang'],
};
// The five island districts whose 2025-01-04 rows carry no ward.
const LEGACY_WARDLESS_DISTRICTS = ['318', '471', '498', '536', '755'];
const DN_CITY_FROM = '2026-04-30';
const QN_CITY_FROM = '2026-09-01';
const BN_CITY_FROM = '2026-09-20';
const PROMOTED_WARDS = {
  '07294': ['Bố Hạ', BN_CITY_FROM],
  '07375': ['Lạng Giang', BN_CITY_FROM],
  '07399': ['Kép', BN_CITY_FROM],
  '07444': ['Lục Nam', BN_CITY_FROM],
  '07840': ['Hiệp Hoà', BN_CITY_FROM],
  '09193': ['Yên Phong', BN_CITY_FROM],
  '09292': ['Phù Lãng', BN_CITY_FROM],
  '09313': ['Chi Lăng', BN_CITY_FROM],
  '09319': ['Tiên Du', BN_CITY_FROM],
  '09454': ['Gia Bình', BN_CITY_FROM],
  '09475': ['Nhân Thắng', BN_CITY_FROM],
  '09496': ['Lương Tài', BN_CITY_FROM],
  25270: ['Lộc Ninh', DN_CITY_FROM],
  25357: ['Tân Khai', DN_CITY_FROM],
  25363: ['Đồng Phú', DN_CITY_FROM],
  26116: ['Tân Phú', DN_CITY_FROM],
  26170: ['Trị An', DN_CITY_FROM],
  26248: ['Trảng Bom', DN_CITY_FROM],
  26326: ['Dầu Giây', DN_CITY_FROM],
  26368: ['Long Thành', DN_CITY_FROM],
  26425: ['Xuân Lộc', DN_CITY_FROM],
  26485: ['Nhơn Trạch', DN_CITY_FROM],
};

export async function referenceCatalogContract({
  db,
  asUser,
  check,
  fails,
  employees,
  root,
}) {
  const asSystem = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
  const day = (value) =>
    value instanceof Date ? value.toISOString().slice(0, 10) : value;
  const unit = async (level, code) =>
    (
      await db.query(
        'select id,name_vi,unit_level,parent_id,valid_from,valid_to from public.admin_unit_versions where source_url=$1 and unit_level=$2 and official_code=$3 order by valid_from',
        [SOURCE_URL, level, code],
      )
    ).rows[0];
  const unitAt = async (level, code, validFrom) =>
    (
      await db.query(
        'select id,name_vi,unit_level,parent_id,valid_from,valid_to from public.admin_unit_versions where source_url=$1 and unit_level=$2 and official_code=$3 and valid_from=$4',
        [SOURCE_URL, level, code, validFrom],
      )
    ).rows[0];
  const window = (row) => [row.name_vi, day(row.valid_from), day(row.valid_to)];
  const legacyUnit = async (level, code) =>
    (
      await db.query(
        'select id,name_vi,unit_level,parent_id,valid_from,valid_to,source_url from public.admin_unit_versions where source_url=$1 and unit_level=$2 and official_code=$3',
        [LEGACY_SOURCE_URL, level, code],
      )
    ).rows[0];
  // The predicate the date-aware catalog read applies: a unit is offered on the day its half-open
  // window covers, so one day answers one generation. Counted on the two seeded sources alone, so
  // fixture units from other contract checks never answer for the catalog.
  const inForceOn = async (on) =>
    rows(
      `select id,unit_level,parent_id from public.admin_unit_versions
        where source_url in ($2,$3) and valid_from<=$1 and (valid_to is null or valid_to>$1)`,
      [on, SOURCE_URL, LEGACY_SOURCE_URL],
    );

  await check(
    'reference catalog seeds every upstream unit once across its dated versions',
    async () => {
      const units = Object.fromEntries(
        (
          await rows(
            'select unit_level,count(distinct official_code)::int as n from public.admin_unit_versions where source_url=$1 group by unit_level',
            [SOURCE_URL],
          )
        ).map((row) => [row.unit_level, row.n]),
      );
      assert.deepEqual(units, { province: 34, commune: 3321 });
      const versions = Object.fromEntries(
        (
          await rows(
            'select unit_level,count(*)::int as n from public.admin_unit_versions where source_url=$1 group by unit_level',
            [SOURCE_URL],
          )
        ).map((row) => [row.unit_level, row.n]),
      );
      assert.deepEqual(versions, { province: 37, commune: 3569 });
      assert.equal(
        (
          await rows(
            "select count(*)::int as n from public.admin_unit_versions where source_url=$1 and valid_from in (date '2026-04-30',date '2026-09-01',date '2026-09-20')",
            [SOURCE_URL],
          )
        )[0].n,
        251,
      );
    },
  );

  await check(
    'reference catalog official codes stay unique and keep leading zeros',
    async () => {
      const duplicates = await rows(
        'select unit_level,official_code from public.admin_unit_versions where source_url=$1 group by unit_level,official_code,valid_from having count(*)>1',
        [SOURCE_URL],
      );
      assert.deepEqual(duplicates, []);
      assert.deepEqual(window(await unit('province', '01')), [
        'Thành phố Hà Nội',
        '2025-07-01',
        null,
      ]);
    },
  );

  await check(
    'one half-open validity window per official name keeps windows non-overlapping',
    async () => {
      const overlaps = await rows(
        `select a.official_code from public.admin_unit_versions a
       join public.admin_unit_versions b
         on b.unit_level=a.unit_level and b.official_code=a.official_code
        and b.valid_from>a.valid_from
      where a.source_url=$1 and b.source_url=$1
        and (a.valid_to is null or a.valid_to>b.valid_from)`,
        [SOURCE_URL],
      );
      assert.deepEqual(overlaps, []);
      const quangNinh = (
        await rows(
          "select name_vi,valid_from,valid_to from public.admin_unit_versions where source_url=$1 and unit_level='province' and official_code='22' order by valid_from",
          [SOURCE_URL],
        )
      ).map(window);
      assert.deepEqual(quangNinh, [
        ['Tỉnh Quảng Ninh', '2025-07-01', QN_CITY_FROM],
        ['Thành phố Quảng Ninh', QN_CITY_FROM, null],
      ]);
      const dongNai = (
        await rows(
          "select name_vi,valid_from,valid_to from public.admin_unit_versions where source_url=$1 and unit_level='province' and official_code='75' order by valid_from",
          [SOURCE_URL],
        )
      ).map(window);
      assert.deepEqual(dongNai, [
        ['Tỉnh Đồng Nai', '2025-07-01', DN_CITY_FROM],
        ['Thành phố Đồng Nai', DN_CITY_FROM, null],
      ]);
      const bacNinh = (
        await rows(
          "select name_vi,valid_from,valid_to from public.admin_unit_versions where source_url=$1 and unit_level='province' and official_code='24' order by valid_from",
          [SOURCE_URL],
        )
      ).map(window);
      assert.deepEqual(bacNinh, [
        ['Tỉnh Bắc Ninh', '2025-07-01', BN_CITY_FROM],
        ['Thành phố Bắc Ninh', BN_CITY_FROM, null],
      ]);
      const bacNinhBaseline = await unitAt('province', '24', '2025-07-01');
      const bacNinhCurrent = await unitAt('province', '24', BN_CITY_FROM);
      for (const [code, [name, from]] of Object.entries(PROMOTED_WARDS)) {
        const provinceCode = code.startsWith('0') ? '24' : '75';
        const provinceBaseline = await unitAt(
          'province',
          provinceCode,
          '2025-07-01',
        );
        const provinceCurrent = await unitAt('province', provinceCode, from);
        const before = await unitAt('commune', code, '2025-07-01');
        const after = await unitAt('commune', code, from);
        assert.deepEqual(window(before), [`Xã ${name}`, '2025-07-01', from]);
        assert.deepEqual(window(after), [`Phường ${name}`, from, null]);
        assert.equal(before.parent_id, provinceBaseline.id);
        assert.equal(after.parent_id, provinceCurrent.id);
      }
      assert.equal(bacNinhBaseline.name_vi, 'Tỉnh Bắc Ninh');
      assert.equal(bacNinhCurrent.name_vi, 'Thành phố Bắc Ninh');
    },
  );

  await check(
    'every seeded commune is parented into a seeded province hierarchy',
    async () => {
      const orphans = await rows(
        `select c.official_code from public.admin_unit_versions c
       where c.source_url=$1 and c.unit_level='commune'
         and not exists (select 1 from public.admin_unit_versions p
                          where p.id=c.parent_id and p.unit_level='province'
                            and p.source_url=$1)`,
        [SOURCE_URL],
      );
      assert.deepEqual(orphans, []);
      const mismatched = await rows(
        `select c.official_code from public.admin_unit_versions c
       join public.admin_unit_versions p on p.id=c.parent_id
      where c.source_url=$1 and c.unit_level='commune'
        and (p.valid_from>c.valid_from
          or (c.valid_to is not null and (p.valid_to is null or p.valid_to<c.valid_to)))`,
        [SOURCE_URL],
      );
      assert.deepEqual(mismatched, []);
    },
  );

  await check(
    'renamed provinces keep a complete commune hierarchy in every dated window',
    async () => {
      const carried = Object.fromEntries(
        (
          await rows(
            `select p.official_code,count(*)::int as n
       from public.admin_unit_versions c
       join public.admin_unit_versions p on p.id=c.parent_id
      where c.source_url=$1 and c.unit_level='commune'
        and p.valid_from in (date '2026-04-30',date '2026-09-01',date '2026-09-20')
      group by p.official_code`,
            [SOURCE_URL],
          )
        ).map((row) => [row.official_code, row.n]),
      );
      assert.deepEqual(carried, { 22: 54, 24: 99, 75: 95 });
    },
  );

  await check(
    'seeded provinces carry the upstream, not the fixture, catalogue',
    async () => {
      const fixtureChildren = await rows(
        `select count(*)::int as n from public.admin_unit_versions c
       join public.admin_unit_versions p on p.id=c.parent_id
       where c.source_url=$1 and c.unit_level='commune' and p.source_url<>$1`,
        [SOURCE_URL],
      );
      assert.equal(fixtureChildren[0].n, 0);
    },
  );

  await check(
    'largest province and commune groups match the upstream release',
    async () => {
      const groups = await rows(
        `select p.official_code,p.name_vi,count(*)::int as n
       from public.admin_unit_versions c
       join public.admin_unit_versions p on p.id=c.parent_id
       where c.source_url=$1 and c.unit_level='commune'
       group by p.official_code,p.name_vi order by n desc`,
        [SOURCE_URL],
      );
      assert.deepEqual(
        groups.slice(0, 2).map((row) => [row.official_code, row.n]),
        [
          ['79', 168],
          ['38', 166],
        ],
      );
      const hcmc = groups.find((row) => row.official_code === '79');
      assert.equal(hcmc.name_vi, 'Thành phố Hồ Chí Minh');
    },
  );

  await check(
    'ward, commune and island special-region rows keep the upstream text',
    async () => {
      const ward = await unit('commune', '26743');
      assert.equal(ward.name_vi, 'Phường Bến Thành');
      const island = await unit('commune', '26732');
      assert.equal(island.name_vi, 'Đặc khu Côn Đảo');
      assert.equal(island.unit_level, 'commune');
      const correctedType = await unit('commune', '06325');
      assert.equal(correctedType.name_vi, 'Xã Bắc Sơn');
    },
  );

  await check(
    'active employees read the catalogue and anonymous callers do not',
    async () => {
      await asUser(null);
      await fails(
        'select count(*) from public.admin_unit_versions',
        [],
        '42501',
      );
      await asUser(0);
      assert.equal(
        (
          await rows(
            'select count(*)::int as n from public.admin_unit_versions where source_url=$1',
            [SOURCE_URL],
          )
        )[0].n,
        3606,
      );
      await asSystem();
    },
  );

  await check(
    'province and commune picker queries return the seeded groups',
    async () => {
      const hcmc = await unit('province', '79');
      const allProvinces = await rows(
        "select id,valid_to from public.admin_unit_versions where unit_level='province'",
      );
      assert.ok(allProvinces.some((row) => day(row.valid_to) === LEGACY_TO));
      const provinces = await rows(
        "select id,valid_to,source_url from public.admin_unit_versions where unit_level='province' and valid_from>=$1",
        [CURRENT_CATALOG_START],
      );
      assert.equal(
        provinces.filter((row) => row.source_url === SOURCE_URL).length,
        37,
      );
      assert.equal(
        provinces.length,
        allProvinces.length -
          allProvinces.filter((row) => day(row.valid_to) === LEGACY_TO).length,
      );
      assert.ok(provinces.every((row) => day(row.valid_to) !== LEGACY_TO));
      const communes = await rows(
        'select id,parent_id,valid_to from public.admin_unit_versions where unit_level=$1 and parent_id=$2 and valid_from>=$3',
        ['commune', hcmc.id, CURRENT_CATALOG_START],
      );
      assert.equal(communes.length, 168);
      assert.ok(communes.every((row) => row.parent_id === hcmc.id));
      assert.ok(communes.every((row) => day(row.valid_to) !== LEGACY_TO));
      // The closed pre-2025 generation stays in the table and is what the date-aware read answers
      // for a legacy date, while today's read never offers it; the inventory area lookup accepts
      // those same ids because it validates any recorded catalog unit, not a generation.
      const legacyDate = await inForceOn('2025-06-30');
      const currentDate = await inForceOn(CURRENT_READ_DAY);
      for (const [level, code] of [
        ['province', '01'],
        ['commune', '00001'],
      ]) {
        const legacy = await legacyUnit(level, code);
        assert.ok(legacyDate.some((row) => row.id === legacy.id));
        assert.ok(!currentDate.some((row) => row.id === legacy.id));
      }
      const bacNinhBaseline = await unitAt('province', '24', '2025-07-01');
      const bacNinhCurrent = await unitAt('province', '24', BN_CITY_FROM);
      const dongNaiCurrent = await unitAt('province', '75', DN_CITY_FROM);
      assert.equal(
        (
          await rows(
            'select id from public.admin_unit_versions where unit_level=$1 and parent_id=$2',
            ['commune', dongNaiCurrent.id],
          )
        ).length,
        95,
      );
      const baselineChildren = await rows(
        'select id from public.admin_unit_versions where unit_level=$1 and parent_id=$2',
        ['commune', bacNinhBaseline.id],
      );
      assert.equal(baselineChildren.length, 99);
      const currentChildren = await rows(
        'select official_code,name_vi from public.admin_unit_versions where unit_level=$1 and parent_id=$2',
        ['commune', bacNinhCurrent.id],
      );
      assert.equal(currentChildren.length, 99);
      for (const [code, [name, from]] of Object.entries(PROMOTED_WARDS)) {
        if (from !== BN_CITY_FROM) continue;
        const child = currentChildren.find((row) => row.official_code === code);
        assert.equal(child.name_vi, `Phường ${name}`);
      }
      await asSystem();
    },
  );

  await check(
    'the catalog read answers the generation in force on the stated day',
    async () => {
      const counts = async (on) => {
        const inForce = await inForceOn(on);
        return {
          province: inForce.filter((row) => row.unit_level === 'province')
            .length,
          district: inForce.filter((row) => row.unit_level === 'district')
            .length,
          commune: inForce.filter((row) => row.unit_level === 'commune').length,
        };
      };
      // A legacy day answers the closed three-tier snapshot and today answers the two-tier rows.
      assert.deepEqual(await counts('2025-06-30'), {
        province: 63,
        district: 696,
        commune: 10051,
      });
      assert.deepEqual(await counts(CURRENT_READ_DAY), {
        province: 34,
        district: 0,
        commune: 3321,
      });
      // A legacy province's districts and a legacy district's wards are one parent hop apart.
      const legacyDate = await inForceOn('2025-06-30');
      const legacyProvince = await legacyUnit('province', '01');
      const districts = legacyDate.filter(
        (row) =>
          row.unit_level === 'district' && row.parent_id === legacyProvince.id,
      );
      assert.ok(districts.length > 0);
      assert.ok(
        legacyDate.some(
          (row) =>
            row.unit_level === 'commune' && row.parent_id === districts[0].id,
        ),
      );
      // No picker page reaches the read's 1,000-unit limit, whatever the day.
      assert.ok(
        (
          await rows(
            `select max(n)::int as n from (
               select count(*) as n from public.admin_unit_versions
                where unit_level='commune' group by parent_id) counted`,
          )
        )[0].n <= 1000,
      );
      await asSystem();
    },
  );

  const catalogProperty = '20000000-0000-4000-8000-0000000000f1';
  const catalogAddress = '21000000-0000-4000-8000-0000000000f1';
  const baselineProperty = '20000000-0000-4000-8000-0000000000f2';
  const baselineAddress = '21000000-0000-4000-8000-0000000000f2';
  const renamedProperty = '20000000-0000-4000-8000-0000000000f3';
  const renamedAddress = '21000000-0000-4000-8000-0000000000f3';
  const quangNinhProperty = '20000000-0000-4000-8000-0000000000f4';
  const quangNinhAddress = '21000000-0000-4000-8000-0000000000f4';
  const dongNaiProperty = '20000000-0000-4000-8000-0000000000f5';
  const dongNaiAddress = '21000000-0000-4000-8000-0000000000f5';
  const maintainSql =
    'select public.maintain_property($1,$2,$3,$4,$5,(select revision from public.properties where id=$1)) as id';
  const addressRevision = async (id) =>
    (
      await db.query(
        'select revision from public.property_addresses where id=$1',
        [id],
      )
    ).rows[0].revision;
  const hcmc = await unit('province', '79');
  const hanoi = await unit('province', '01');
  const benThanh = await unit('commune', '26743');

  await asSystem();
  await db.query(
    "insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-CAT-REF-1','sale','available',$6),($2,'SGN-CAT-REF-2','sale','available',$6),($3,'SGN-CAT-REF-3','sale','available',$6),($4,'SGN-CAT-REF-4','sale','available',$6),($5,'SGN-CAT-REF-5','sale','available',$6)",
    [
      catalogProperty,
      baselineProperty,
      renamedProperty,
      quangNinhProperty,
      dongNaiProperty,
      employees[0],
    ],
  );
  await db.query(
    "insert into public.property_addresses(id,property_id,format,address_text,mapping_status) values($1,$2,'current','Số 1 đường tham chiếu','unresolved'),($3,$4,'current','Số 2 đường tham chiếu cơ sở','unresolved'),($5,$6,'current','Số 3 đường tham chiếu đổi tên','unresolved'),($7,$8,'current','Số 4 đường tham chiếu Quảng Ninh','unresolved'),($9,$10,'current','Số 5 đường tham chiếu Đồng Nai','unresolved')",
    [
      catalogAddress,
      catalogProperty,
      baselineAddress,
      baselineProperty,
      renamedAddress,
      renamedProperty,
      quangNinhAddress,
      quangNinhProperty,
      dongNaiAddress,
      dongNaiProperty,
    ],
  );
  await asUser(2);
  const verifiedChanges = {
    province_unit_id: hcmc.id,
    commune_unit_id: benThanh.id,
    mapping_status: 'verified',
    verification_method: 'manual',
    source_url: 'https://example.test/catalog-evidence',
    effective_on: '2026-10-10',
    mapping_evidence:
      'Recorded lease and boundary evidence for the seeded ward',
  };
  await check(
    'verified current address accepts the seeded hierarchy inside its validity window',
    async () => {
      const revision = await addressRevision(catalogAddress);
      await db.query(maintainSql, [
        catalogProperty,
        'mapping',
        catalogAddress,
        revision,
        verifiedChanges,
      ]);
    },
  );
  await check(
    'a current address outside the seeded validity window is rejected',
    async () => {
      const revision = await addressRevision(catalogAddress);
      await fails(
        maintainSql,
        [
          catalogProperty,
          'mapping',
          catalogAddress,
          revision,
          { ...verifiedChanges, effective_on: '2024-10-10' },
        ],
        '23514',
      );
    },
  );
  await check(
    'a commune under another province is rejected against the seeded hierarchy',
    async () => {
      const revision = await addressRevision(catalogAddress);
      await fails(
        maintainSql,
        [
          catalogProperty,
          'mapping',
          catalogAddress,
          revision,
          { ...verifiedChanges, province_unit_id: hanoi.id },
        ],
        '23514',
      );
    },
  );
  await check(
    'area analytics labels the verified commune with its seeded official name',
    async () => {
      const labelled = await rows(
        "select current_commune_label from public.v_admin_inventory_by_area where current_commune_label='Phường Bến Thành'",
      );
      assert.ok(labelled.length >= 1);
    },
  );
  const bacNinhBaseline = await unitAt('province', '24', '2025-07-01');
  const bacNinhCurrent = await unitAt('province', '24', BN_CITY_FROM);
  const boHaBaseline = await unitAt('commune', '07294', '2025-07-01');
  const boHaCurrent = await unitAt('commune', '07294', BN_CITY_FROM);
  await check(
    'a verification dated on the 2025 baseline reports the 2025 official labels',
    async () => {
      const revision = await addressRevision(baselineAddress);
      await db.query(maintainSql, [
        baselineProperty,
        'mapping',
        baselineAddress,
        revision,
        {
          ...verifiedChanges,
          province_unit_id: bacNinhBaseline.id,
          commune_unit_id: boHaBaseline.id,
          effective_on: '2025-07-01',
        },
      ]);
      assert.deepEqual(
        await rows(
          'select province_label,current_commune_label from public.v_admin_inventory_by_area where current_commune_id=$1',
          [boHaBaseline.id],
        ),
        [
          {
            province_label: 'Tỉnh Bắc Ninh',
            current_commune_label: 'Xã Bố Hạ',
          },
        ],
      );
    },
  );
  await check(
    'a verification dated inside the 2026 rename window reports the renamed labels',
    async () => {
      const revision = await addressRevision(renamedAddress);
      await db.query(maintainSql, [
        renamedProperty,
        'mapping',
        renamedAddress,
        revision,
        {
          ...verifiedChanges,
          province_unit_id: bacNinhCurrent.id,
          commune_unit_id: boHaCurrent.id,
          effective_on: '2026-10-01',
        },
      ]);
      assert.deepEqual(
        await rows(
          'select province_label,current_commune_label from public.v_admin_inventory_by_area where current_commune_id=$1',
          [boHaCurrent.id],
        ),
        [
          {
            province_label: 'Thành phố Bắc Ninh',
            current_commune_label: 'Phường Bố Hạ',
          },
        ],
      );
    },
  );
  await check(
    'a verification dated before a dated version starts is rejected',
    async () => {
      const revision = await addressRevision(renamedAddress);
      await fails(
        maintainSql,
        [
          renamedProperty,
          'mapping',
          renamedAddress,
          revision,
          {
            ...verifiedChanges,
            province_unit_id: bacNinhCurrent.id,
            commune_unit_id: boHaCurrent.id,
            effective_on: '2026-09-19',
          },
        ],
        '23514',
      );
    },
  );
  const quangNinhCurrent = await unitAt('province', '22', QN_CITY_FROM);
  const baCheCurrent = await unitAt('commune', '06970', QN_CITY_FROM);
  await check(
    'a verification dated inside the Quảng Ninh rename window reports the city label',
    async () => {
      const revision = await addressRevision(quangNinhAddress);
      await db.query(maintainSql, [
        quangNinhProperty,
        'mapping',
        quangNinhAddress,
        revision,
        {
          ...verifiedChanges,
          province_unit_id: quangNinhCurrent.id,
          commune_unit_id: baCheCurrent.id,
          effective_on: QN_CITY_FROM,
        },
      ]);
      assert.deepEqual(
        await rows(
          'select province_label,current_commune_label from public.v_admin_inventory_by_area where current_commune_id=$1',
          [baCheCurrent.id],
        ),
        [
          {
            province_label: 'Thành phố Quảng Ninh',
            current_commune_label: 'Xã Ba Chẽ',
          },
        ],
      );
    },
  );
  await check(
    'a verification dated before the Quảng Ninh city window is rejected',
    async () => {
      const revision = await addressRevision(quangNinhAddress);
      await fails(
        maintainSql,
        [
          quangNinhProperty,
          'mapping',
          quangNinhAddress,
          revision,
          {
            ...verifiedChanges,
            province_unit_id: quangNinhCurrent.id,
            commune_unit_id: baCheCurrent.id,
            effective_on: '2026-08-31',
          },
        ],
        '23514',
      );
    },
  );
  const dongNaiCurrent = await unitAt('province', '75', DN_CITY_FROM);
  const locNinhCurrent = await unitAt('commune', '25270', DN_CITY_FROM);
  await check(
    'a verification dated inside the Đồng Nai promotion window reports the renamed labels',
    async () => {
      const revision = await addressRevision(dongNaiAddress);
      await db.query(maintainSql, [
        dongNaiProperty,
        'mapping',
        dongNaiAddress,
        revision,
        {
          ...verifiedChanges,
          province_unit_id: dongNaiCurrent.id,
          commune_unit_id: locNinhCurrent.id,
          effective_on: '2026-05-01',
        },
      ]);
      assert.deepEqual(
        await rows(
          'select province_label,current_commune_label from public.v_admin_inventory_by_area where current_commune_id=$1',
          [locNinhCurrent.id],
        ),
        [
          {
            province_label: 'Thành phố Đồng Nai',
            current_commune_label: 'Phường Lộc Ninh',
          },
        ],
      );
    },
  );
  await check(
    'a verification dated before the Đồng Nai city window is rejected',
    async () => {
      const revision = await addressRevision(dongNaiAddress);
      await fails(
        maintainSql,
        [
          dongNaiProperty,
          'mapping',
          dongNaiAddress,
          revision,
          {
            ...verifiedChanges,
            province_unit_id: dongNaiCurrent.id,
            commune_unit_id: locNinhCurrent.id,
            effective_on: '2026-04-29',
          },
        ],
        '23514',
      );
    },
  );
  await asUser(0);
  await check(
    'ordinary employees cannot read the manager area analytics over the catalogue',
    async () =>
      assert.deepEqual(
        await rows('select * from public.v_admin_inventory_by_area'),
        [],
      ),
  );
  await asSystem();

  await check(
    're-applying the seed migration converges without duplicating or re-keying rows',
    async () => {
      const before = (
        await rows(
          'select count(*)::int as n from public.admin_unit_versions where source_url=$1 union all select count(distinct id)::int from public.admin_unit_versions where source_url=$1',
          [SOURCE_URL],
        )
      ).map((row) => row.n);
      const sample = await rows(
        "select id,valid_from from public.admin_unit_versions where source_url=$1 and unit_level='commune' and official_code in ('26743','07294') order by official_code,valid_from",
        [SOURCE_URL],
      );
      assert.equal(sample.length, 3);
      const files = (
        await fs.readdir(path.join(root, 'supabase/migrations'))
      ).filter((name) => name.endsWith(MIGRATION_SUFFIX));
      assert.equal(files.length, 1);
      await db.exec(
        await fs.readFile(
          path.join(root, 'supabase/migrations', files[0]),
          'utf8',
        ),
      );
      const after = (
        await rows(
          'select count(*)::int as n from public.admin_unit_versions where source_url=$1 union all select count(distinct id)::int from public.admin_unit_versions where source_url=$1',
          [SOURCE_URL],
        )
      ).map((row) => row.n);
      assert.deepEqual(after, before);
      assert.deepEqual(
        await rows(
          "select id,valid_from from public.admin_unit_versions where source_url=$1 and unit_level='commune' and official_code in ('26743','07294') order by official_code,valid_from",
          [SOURCE_URL],
        ),
        sample,
      );
      assert.deepEqual(
        await rows(
          'select unit_level,official_code,valid_from from public.admin_unit_versions group by unit_level,official_code,valid_from having count(*)>1',
        ),
        [],
      );
    },
  );

  await asSystem();

  await check(
    'legacy catalog seeds the pre-2025 snapshot on the closed window only',
    async () => {
      const counts = Object.fromEntries(
        (
          await rows(
            "select unit_level,count(*)::int as n from public.admin_unit_versions where valid_to=date '2025-07-01' group by unit_level",
          )
        ).map((row) => [row.unit_level, row.n]),
      );
      assert.deepEqual(counts, { district: 696, commune: 10051, province: 63 });
      const codes = Object.fromEntries(
        (
          await rows(
            'select unit_level,count(distinct official_code)::int as n from public.admin_unit_versions where source_url=$1 group by unit_level',
            [LEGACY_SOURCE_URL],
          )
        ).map((row) => [row.unit_level, row.n]),
      );
      assert.deepEqual(codes, { district: 696, commune: 10051, province: 63 });
      // Every legacy row carries the pinned snapshot as its provenance, opens on
      // the snapshot date and closes at the rearrangement date: no open sentinel
      // and no claim outside the source's range.
      assert.deepEqual(
        await rows(
          "select unit_level,official_code from public.admin_unit_versions where source_url=$1 and (valid_from<>date '2025-01-04' or valid_to is distinct from date '2025-07-01')",
          [LEGACY_SOURCE_URL],
        ),
        [],
      );
      assert.deepEqual(
        await rows(
          "select unit_level,official_code from public.admin_unit_versions where valid_to=date '2025-07-01' and source_url<>$1",
          [LEGACY_SOURCE_URL],
        ),
        [],
      );
      assert.deepEqual(window(await legacyUnit('province', '01')), [
        'Thành phố Hà Nội',
        LEGACY_FROM,
        LEGACY_TO,
      ]);
      assert.deepEqual(window(await legacyUnit('district', '001')), [
        'Quận Ba Đình',
        LEGACY_FROM,
        LEGACY_TO,
      ]);
      assert.deepEqual(window(await legacyUnit('commune', '00001')), [
        'Phường Phúc Xá',
        LEGACY_FROM,
        LEGACY_TO,
      ]);
    },
  );

  await check(
    'every legacy child is parented inside the same legacy generation',
    async () => {
      const wrongParents = await rows(
        `select c.unit_level,c.official_code from public.admin_unit_versions c
       left join public.admin_unit_versions p on p.id=c.parent_id
      where c.source_url=$1
        and ((c.unit_level='province' and c.parent_id is not null)
          or (c.unit_level='district' and (p.unit_level is distinct from 'province' or p.source_url is distinct from $1 or p.valid_from is distinct from date '2025-01-04'))
          or (c.unit_level='commune' and (p.unit_level is distinct from 'district' or p.source_url is distinct from $1 or p.valid_from is distinct from date '2025-01-04')))`,
        [LEGACY_SOURCE_URL],
      );
      assert.deepEqual(wrongParents, []);
      assert.equal(
        (await legacyUnit('commune', '00001')).parent_id,
        (await legacyUnit('district', '001')).id,
      );
      assert.equal(
        (await legacyUnit('district', '001')).parent_id,
        (await legacyUnit('province', '01')).id,
      );
      // The five island districts exist with no wards beneath them.
      assert.deepEqual(
        (
          await rows(
            `select d.official_code,d.name_vi from public.admin_unit_versions d
       where d.source_url=$1 and d.unit_level='district'
         and not exists (select 1 from public.admin_unit_versions c where c.parent_id=d.id)
      order by d.official_code`,
            [LEGACY_SOURCE_URL],
          )
        ).map((row) => row.official_code),
        LEGACY_WARDLESS_DISTRICTS,
      );
    },
  );

  await check(
    'legacy and current generations share a code without overlapping windows',
    async () => {
      const overlaps = await rows(
        `select a.unit_level,a.official_code from public.admin_unit_versions a
       join public.admin_unit_versions b
         on b.unit_level=a.unit_level and b.official_code=a.official_code
        and b.valid_from>a.valid_from
      where a.valid_to is null or a.valid_to>b.valid_from`,
      );
      assert.deepEqual(overlaps, []);
      for (const [code, [legacyName, currentName]] of Object.entries(
        REUSED_PROVINCE_CODES,
      )) {
        assert.deepEqual(window(await legacyUnit('province', code)), [
          legacyName,
          LEGACY_FROM,
          LEGACY_TO,
        ]);
        assert.equal(
          (await unitAt('province', code, '2025-07-01')).name_vi,
          currentName,
        );
      }
      // One code names two different units in the two generations; only the
      // validity window separates them.
      assert.equal(
        (await legacyUnit('commune', '00004')).name_vi,
        'Phường Trúc Bạch',
      );
      assert.equal(
        (await unitAt('commune', '00004', '2025-07-01')).name_vi,
        'Phường Ba Đình',
      );
    },
  );

  await check(
    'anonymous callers read no legacy row and employees read all of them',
    async () => {
      await asUser(null);
      await fails(
        'select count(*) from public.admin_unit_versions where source_url=$1',
        [LEGACY_SOURCE_URL],
        '42501',
      );
      await asUser(0);
      assert.equal(
        (
          await rows(
            'select count(*)::int as n from public.admin_unit_versions where source_url=$1',
            [LEGACY_SOURCE_URL],
          )
        )[0].n,
        10810,
      );
      await asSystem();
    },
  );

  const legacyProvince = await legacyUnit('province', '01');
  const legacyDistrict = await legacyUnit('district', '001');
  const legacyWard = await legacyUnit('commune', '00001');
  const otherDistrict = await legacyUnit('district', '002');
  const legacyProperty = '20000000-0000-4000-8000-0000000000f6';
  const legacyAddressSql =
    "insert into public.property_addresses(property_id,format,address_text,is_primary,province_unit_id,district_unit_id,commune_unit_id) values($1,'legacy','Số 1 ngõ 2 phố cổ',$2,$3,$4,$5)";
  await db.query(
    "insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-LEGACY-REF-1','sale','available',$2)",
    [legacyProperty, employees[0]],
  );
  await check(
    'the address guard accepts a legacy address carrying all three unit ids',
    async () => {
      await db.query(legacyAddressSql, [
        legacyProperty,
        true,
        legacyProvince.id,
        legacyDistrict.id,
        legacyWard.id,
      ]);
      assert.deepEqual(
        await rows(
          'select format,province_unit_id,district_unit_id,commune_unit_id from public.property_addresses where property_id=$1',
          [legacyProperty],
        ),
        [
          {
            format: 'legacy',
            province_unit_id: legacyProvince.id,
            district_unit_id: legacyDistrict.id,
            commune_unit_id: legacyWard.id,
          },
        ],
      );
    },
  );
  await check(
    'a legacy ward outside its district is rejected against the seeded chain',
    () =>
      fails(
        legacyAddressSql,
        [
          legacyProperty,
          false,
          legacyProvince.id,
          otherDistrict.id,
          legacyWard.id,
        ],
        '23514',
      ),
  );

  await check(
    'every closed pre-2025 row cites the one pinned source file',
    async () => {
      assert.deepEqual(
        await rows(
          "select distinct source_url from public.admin_unit_versions where unit_level in ('province','district','commune') and valid_to=date '2025-07-01'",
        ),
        [{ source_url: LEGACY_SOURCE_URL }],
      );
    },
  );

  await check(
    're-applying the legacy seed converges without duplicating or re-keying rows',
    async () => {
      const before = (
        await rows(
          'select count(*)::int as n from public.admin_unit_versions where source_url=$1 union all select count(distinct id)::int from public.admin_unit_versions where source_url=$1',
          [LEGACY_SOURCE_URL],
        )
      ).map((row) => row.n);
      assert.deepEqual(before, [10810, 10810]);
      const sampleSql =
        "select id,unit_level,official_code,parent_id,valid_from,valid_to from public.admin_unit_versions where source_url=$1 and official_code in ('01','001','00001') and valid_from=date '2025-01-04' order by unit_level,official_code";
      const sample = await rows(sampleSql, [LEGACY_SOURCE_URL]);
      assert.equal(sample.length, 3);
      await db.exec(
        await fs.readFile(
          path.join(
            root,
            'supabase/migrations',
            (await fs.readdir(path.join(root, 'supabase/migrations'))).find(
              (name) => name.endsWith(LEGACY_MIGRATION_SUFFIX),
            ),
          ),
          'utf8',
        ),
      );
      const after = (
        await rows(
          'select count(*)::int as n from public.admin_unit_versions where source_url=$1 union all select count(distinct id)::int from public.admin_unit_versions where source_url=$1',
          [LEGACY_SOURCE_URL],
        )
      ).map((row) => row.n);
      assert.deepEqual(after, before);
      assert.deepEqual(await rows(sampleSql, [LEGACY_SOURCE_URL]), sample);
      assert.deepEqual(
        await rows(
          'select unit_level,official_code,valid_from from public.admin_unit_versions group by unit_level,official_code,valid_from having count(*)>1',
        ),
        [],
      );
    },
  );

  await asSystem();
}
