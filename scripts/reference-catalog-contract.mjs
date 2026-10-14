import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Vietnamese province/city and ward/commune reference catalog seeded by
// 20261014075435_vietnamese_admin_units_reference.sql from
// thanglequoc/vietnamese-provinces-database: pre-2026 names (upstream v3.0.2)
// for the 2025-07-01 baseline window, and the v5.2.0 names for the 2026-04-30
// Đồng Nai, 2026-09-01 Quảng Ninh and 2026-09-20 Bắc Ninh windows.
// It proves the seeded codes, hierarchy, half-open validity windows and counts,
// the idempotent re-application, and the delivered address paths that consume
// the catalog (the admin-unit picker query, the verified-mapping guard and the
// per-date area analytics label). Real hosted Supabase, the HTTP route and
// browser acceptance stay a staging gate.
const SOURCE_URL =
  'https://github.com/thanglequoc/vietnamese-provinces-database/blob/v5.2.0/postgresql/postgres_ImportData_vn_units.sql';
const MIGRATION_SUFFIX = '_vietnamese_admin_units_reference.sql';
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
      const provinces = await rows(
        "select id from public.admin_unit_versions where unit_level='province' and source_url=$1",
        [SOURCE_URL],
      );
      assert.equal(provinces.length, 37);
      const communes = await rows(
        'select id,parent_id from public.admin_unit_versions where unit_level=$1 and parent_id=$2',
        ['commune', hcmc.id],
      );
      assert.equal(communes.length, 168);
      assert.ok(communes.every((row) => row.parent_id === hcmc.id));
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
}
