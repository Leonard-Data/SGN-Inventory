import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// The private audit trail is written only by private.audit_change() and read by nothing in the
// application, so these embedded regressions cover the retention rule itself: rows inside the
// window survive and rows outside it become eligible, a repeated run is safe and stays bound to
// this one table, a bad window cannot become a wipe, and no application or API role can trim
// the trail or reach its contents. The real size effect on a hosted project stays a staging
// gate; this proves the database rules.
export async function auditRetentionContract({
  db,
  asUser,
  check,
  fails,
  employees,
}) {
  const trim = 'select private.trim_audit_events($1,$2) as removed';
  const trimDefaults = 'select private.trim_audit_events() as removed';
  const asOwner = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  const countAll = async () =>
    (await db.query('select count(*)::int as n from private.audit_events'))
      .rows[0].n;
  const exists = async (id) =>
    (
      await db.query(
        'select count(*)::int as n from private.audit_events where id=$1',
        [id],
      )
    ).rows[0].n === 1;
  const insertAge = async (ageDays) =>
    (
      await db.query(
        `insert into private.audit_events(actor_user_id,table_name,record_key,action,before_data,after_data,created_at)
         values (null,'properties',$1,'UPDATE','{"sale_price_vnd":"1000000000"}'::jsonb,'{"sale_price_vnd":"1100000000"}'::jsonb, now() - make_interval(days => $2))
         returning id`,
        [`retention-fixture-${randomUUID()}`, ageDays],
      )
    ).rows[0].id;

  await asOwner();
  const insideId = await insertAge(364);
  const outsideId = await insertAge(366);
  const before = await countAll();

  await check(
    'trim removes only audit rows older than the retained window',
    async () => {
      const removed = (await db.query(trimDefaults)).rows[0].removed;
      assert.ok(removed >= 1, 'the 366-day-old row must be eligible');
      assert.equal(await exists(outsideId), false);
      assert.equal(await exists(insideId), true);
      assert.equal(await countAll(), before - removed);
    },
  );

  await check(
    'a repeated trim finds nothing eligible and removes nothing',
    async () => {
      assert.equal((await db.query(trimDefaults)).rows[0].removed, 0);
      assert.equal(await exists(insideId), true);
    },
  );

  await check(
    'the row cap bounds one call and a repeated call continues the trim',
    async () => {
      const batch = [];
      for (let i = 0; i < 3; i += 1) batch.push(await insertAge(400 + i));
      assert.equal((await db.query(trim, [365, 2])).rows[0].removed, 2);
      assert.equal((await db.query(trim, [365, 2])).rows[0].removed, 1);
      for (const id of batch) assert.equal(await exists(id), false);
      assert.equal(await exists(insideId), true);
    },
  );

  await check('a window that would wipe the trail is refused', async () => {
    await fails('select private.trim_audit_events(0)', [], '22023');
    await fails('select private.trim_audit_events(29)', [], '22023');
    await fails('select private.trim_audit_events(3651)', [], '22023');
    await fails(trim, [365, 0], '22023');
    await fails(trim, [null, 10], '22023');
    assert.ok((await countAll()) >= 1);
  });

  await check(
    'the trim is bound to its own table with no dynamic SQL',
    async () => {
      const args = (
        await db.query(
          "select pg_get_function_arguments(to_regprocedure('private.trim_audit_events(integer,integer)')) as args",
        )
      ).rows[0].args;
      assert.equal(args.split(',').length, 2);
      assert.ok(
        !/text|name|regclass|oid/i.test(args),
        'the trim takes a window and a row cap, never a table identity',
      );
      const body = (
        await db.query(
          "select prosrc from pg_proc where oid = to_regprocedure('private.trim_audit_events(integer,integer)')",
        )
      ).rows[0].prosrc;
      assert.ok(body.includes('private.audit_events'));
      assert.ok(!/\bexecute\b|\bformat\s*\(/i.test(body), 'no dynamic SQL');
      const sha = randomUUID().replace(/-/g, '');
      await db.query(
        "insert into private.import_batches(source_sha256,filename,status,created_at) values($1,'retention-fixture.csv','staged', now() - interval '4000 days')",
        [sha],
      );
      assert.equal((await db.query(trimDefaults)).rows[0].removed, 0);
      assert.equal(
        (
          await db.query(
            'select count(*)::int as n from private.import_batches where source_sha256=$1',
            [sha],
          )
        ).rows[0].n,
        1,
      );
    },
  );

  await asUser(0);
  await check(
    'an active employee cannot trim or read the audit trail',
    async () => {
      await fails('select private.trim_audit_events(365)', [], '42501');
      await fails('delete from private.audit_events', [], '42501');
      await fails('select * from private.audit_events', [], '42501');
    },
  );
  await asUser(null);
  await check('an anonymous caller cannot trim the audit trail', () =>
    fails('select private.trim_audit_events(365)', [], '42501'),
  );
  await asOwner();
  await check(
    'the trusted server role has no trim privilege either',
    async () => {
      await db.exec('set role service_role');
      await fails('select private.trim_audit_events(365)', [], '42501');
      await db.exec('reset role');
    },
  );

  await check(
    'the trail still records protected changes after a trim',
    async () => {
      await asOwner();
      const property = randomUUID();
      await db.query(
        "insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,$2,'sale','available',$3)",
        [
          property,
          `SGN-RET-${randomUUID().slice(0, 8).toUpperCase()}`,
          employees[0],
        ],
      );
      await asUser(2);
      const event = (
        await db.query(
          "select public.record_property_activity($1,'page_view',$2) as id",
          [property, randomUUID()],
        )
      ).rows[0].id;
      await asOwner();
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from private.audit_events where table_name='activity_events' and record_key=$1",
            [event],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(await exists(insideId), true);
    },
  );
}
