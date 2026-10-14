import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Vietnamese province/city and ward/commune reference catalog seeded by
// 20261014075435_vietnamese_admin_units_reference.sql from
// thanglequoc/vietnamese-provinces-database v5.2.0.
// It proves the seeded codes, hierarchy and counts, the idempotent re-application,
// and the delivered address paths that consume the catalog (the admin-unit picker
// query, the verified-mapping guard and the area analytics label). Real hosted
// Supabase, the HTTP route and browser acceptance stay a staging gate.
const SOURCE_URL =
  'https://github.com/thanglequoc/vietnamese-provinces-database/blob/v5.2.0/postgresql/postgres_ImportData_vn_units.sql';
const MIGRATION_SUFFIX = '_vietnamese_admin_units_reference.sql';

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
  const unit = async (level, code) =>
    (
      await db.query(
        'select id,name_vi,unit_level,parent_id,valid_from from public.admin_unit_versions where source_url=$1 and unit_level=$2 and official_code=$3',
        [SOURCE_URL, level, code],
      )
    ).rows[0];

  await check(
    'reference catalog seeds every upstream province and commune once',
    async () => {
      const counts = Object.fromEntries(
        (
          await rows(
            'select unit_level,count(*)::int as n from public.admin_unit_versions where source_url=$1 group by unit_level',
            [SOURCE_URL],
          )
        ).map((row) => [row.unit_level, row.n]),
      );
      assert.deepEqual(counts, { province: 34, commune: 3321 });
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
      const hanoi = await unit('province', '01');
      assert.equal(hanoi.name_vi, 'Thành phố Hà Nội');
      assert.equal(hanoi.valid_from.toISOString().slice(0, 10), '2025-07-01');
    },
  );

  await check(
    'every seeded commune is parented into a seeded province hierarchy',
    async () => {
      const orphans = await rows(
        `select c.official_code from public.admin_unit_versions c
       where c.source_url=$1 and c.unit_level='commune'
         and not exists (select 1 from public.admin_unit_versions p
                          where p.id=c.parent_id and p.unit_level='province')`,
        [SOURCE_URL],
      );
      assert.deepEqual(orphans, []);
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
        3355,
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
      assert.equal(provinces.length, 34);
      const communes = await rows(
        'select id,parent_id from public.admin_unit_versions where unit_level=$1 and parent_id=$2',
        ['commune', hcmc.id],
      );
      assert.equal(communes.length, 168);
      assert.ok(communes.every((row) => row.parent_id === hcmc.id));
      await asSystem();
    },
  );

  const catalogProperty = '20000000-0000-4000-8000-0000000000f1';
  const catalogAddress = '21000000-0000-4000-8000-0000000000f1';
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
    "insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-CAT-REF-1','sale','available',$2)",
    [catalogProperty, employees[0]],
  );
  await db.query(
    "insert into public.property_addresses(id,property_id,format,address_text,mapping_status) values($1,$2,'current','Số 1 đường tham chiếu','unresolved')",
    [catalogAddress, catalogProperty],
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
        "select id from public.admin_unit_versions where source_url=$1 and official_code='26743' and unit_level='commune'",
        [SOURCE_URL],
      );
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
          "select id from public.admin_unit_versions where source_url=$1 and official_code='26743' and unit_level='commune'",
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
