import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// The private audit trail is written only by private.audit_change() and read by nothing in the
// application, so these embedded regressions cover the retention rule itself: rows inside the
// window survive and rows outside it become eligible, a repeated run is safe and stays bound to
// this one table, and no application or API role can trim the trail or reach its contents. The
// real size effect on a hosted project stays a staging gate; this proves the database rules.
export async function auditRetentionContract({
  db,
  asUser,
  check,
  fails,
  employees,
}) {
  const trim = 'select private.trim_audit_events() as removed';
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
  const insideId = await insertAge(89);
  const outsideId = await insertAge(91);
  const before = await countAll();

  await check(
    'trim removes only audit rows older than the retained window',
    async () => {
      const removed = (await db.query(trim)).rows[0].removed;
      assert.ok(removed >= 1, 'the 91-day-old row must be eligible');
      assert.equal(await exists(outsideId), false);
      assert.equal(await exists(insideId), true);
      assert.equal(await countAll(), before - removed);
    },
  );

  await check(
    'a repeated trim finds nothing eligible and removes nothing',
    async () => {
      assert.equal((await db.query(trim)).rows[0].removed, 0);
      assert.equal(await exists(insideId), true);
    },
  );

  await check(
    'the parameterless trim stays bound to the audit table',
    async () => {
      await fails(
        'select private.trim_audit_events($1)',
        ['private.import_batches'],
        '42883',
      );
      const sha = randomUUID().replace(/-/g, '');
      await db.query(
        "insert into private.import_batches(source_sha256,filename,status,created_at) values($1,'retention-fixture.csv','staged', now() - interval '4000 days')",
        [sha],
      );
      assert.equal((await db.query(trim)).rows[0].removed, 0);
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
      await fails(trim, [], '42501');
      await fails('delete from private.audit_events', [], '42501');
      await fails('select * from private.audit_events', [], '42501');
    },
  );
  await asUser(null);
  await check('an anonymous caller cannot trim the audit trail', () =>
    fails(trim, [], '42501'),
  );
  await asOwner();
  await check(
    'the trusted server role has no trim privilege either',
    async () => {
      await db.exec('set role service_role');
      await fails(trim, [], '42501');
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
