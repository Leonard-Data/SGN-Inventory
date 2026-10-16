import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { applyEmbeddedSchema } from './embedded-schema.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export async function propertyVendorLinksConcurrency({ root, check }) {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sgn74-pg-'));
  const databasePassword = randomUUID();
  const engine = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: databasePassword,
    port,
    persistent: false,
    onLog: () => {},
  });
  const connectionConfig = {
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password: databasePassword,
    database: 'postgres',
  };
  let owner;
  try {
    await engine.initialise();
    await engine.start();
    owner = new pg.Client(connectionConfig);
    await owner.connect();
    await applyEmbeddedSchema({ root, exec: (sql) => owner.query(sql) });

    const actorLink = '97000000-0000-4000-8000-0000000000a1';
    const actorCreate = '97000000-0000-4000-8000-0000000000a2';
    const actorConcurrent = '97000000-0000-4000-8000-0000000000a3';
    const property = '27000000-0000-4000-8000-0000000000a1';
    const vendor = '37000000-0000-4000-8000-0000000000a1';
    const propertyRevision = randomUUID();
    await owner.query('insert into auth.users values ($1),($2),($3)', [
      actorLink,
      actorCreate,
      actorConcurrent,
    ]);
    await owner.query(
      "insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ($1,$1,'link-race@example.test','Link Race','staff',true), ($2,$2,'create-race@example.test','Create Race','staff',true), ($3,$3,'concurrent-race@example.test','Concurrent Race','staff',true)",
      [actorLink, actorCreate, actorConcurrent],
    );
    await owner.query(
      "insert into public.properties(id,property_code,listing_mode,status,created_by,revision) values ($1,'SGN-RACE','sale','available',$2,$3)",
      [property, actorLink, propertyRevision],
    );
    await owner.query(
      "insert into public.vendors(id,display_name,created_by,submission_key) values ($1,'Race Vendor',$2,$3)",
      [vendor, actorLink, randomUUID()],
    );

    async function runRace({ actor, call, inspect, name }) {
      let first;
      let second;
      try {
        first = new pg.Client(connectionConfig);
        second = new pg.Client(connectionConfig);
        await first.connect();
        await second.connect();
        await second.query("select set_config('request.jwt.claim.sub',$1,false)", [
          actor,
        ]);
        await second.query('set role authenticated');
        await first.query('begin');
        await first.query('select private.maintenance_gate()');
        await second.query('begin');
        let settled = false;
        const pending = second.query(call).then(
          () => {
            settled = true;
            return null;
          },
          (error) => {
            settled = true;
            return error;
          },
        );
        await sleep(750);
        const waited = !settled;
        await first.query('update public.employees set is_active=false where id=$1', [
          actor,
        ]);
        await first.query('commit');
        const outcome = await pending;
        await second.query('rollback').catch(() => {});
        await check(name, async () => {
          assert.equal(waited, true, 'the guarded call must wait on the maintenance gate');
          assert.equal(outcome?.code, '42501');
          await inspect();
        });
      } finally {
        await second?.end().catch(() => {});
        await first?.end().catch(() => {});
      }
    }

    await runRace({
      actor: actorLink,
      name: 'link race rechecks live membership before writing the link or property history',
      call: `select public.link_property_vendor('${property}','${vendor}','${propertyRevision}')`,
      inspect: async () => {
        assert.deepEqual(
          (
            await owner.query(
              'select property_id,vendor_id from public.property_vendors where property_id=$1 and vendor_id=$2',
              [property, vendor],
            )
          ).rows,
          [],
        );
        assert.deepEqual(
          (
            await owner.query(
              "select target,target_id from public.property_history where property_id=$1 and target='vendor_link'",
              [property],
            )
          ).rows,
          [],
        );
      },
    });

    await runRace({
      actor: actorCreate,
      name: 'vendor create race rechecks live membership before writing the vendor',
      call: `select public.create_vendor('${randomUUID()}','Race Create Vendor')`,
      inspect: async () => {
        assert.deepEqual(
          (
            await owner.query(
              "select display_name from public.vendors where display_name='Race Create Vendor'",
            )
          ).rows,
          [],
        );
      },
    });

    let first;
    let second;
    try {
      first = new pg.Client(connectionConfig);
      second = new pg.Client(connectionConfig);
      await first.connect();
      await second.connect();
      for (const client of [first, second]) {
        await client.query("select set_config('request.jwt.claim.sub',$1,false)", [
          actorConcurrent,
        ]);
        await client.query('set role authenticated');
        await client.query('begin');
      }
      const link =
        'select public.link_property_vendor($1,$2,(select revision from public.properties where id=$1)) as link';
      const firstOutcome = (await first.query(link, [property, vendor])).rows[0].link;
      let secondSettled = false;
      let secondOutcome;
      let secondError;
      const secondRequest = second.query(link, [property, vendor]).then(
        (result) => {
          secondSettled = true;
          secondOutcome = result.rows[0].link;
        },
        (error) => {
          secondSettled = true;
          secondError = error;
        },
      );
      await sleep(750);
      const waited = !secondSettled;
      await first.query('commit');
      await secondRequest;
      await second.query('commit');
      const rows = await owner.query(
        'select property_id,vendor_id,revision,created_by,created_at from public.property_vendors where property_id=$1 and vendor_id=$2',
        [property, vendor],
      );
      const history = await owner.query(
        "select actor_id,changed_fields from public.property_history where property_id=$1 and target='vendor_link'",
        [property],
      );
      await check('a concurrent second link waits for the first transaction', () => {
        assert.equal(waited, true);
      });
      await check('two authenticated link sessions converge on one current row without property history', () => {
        assert.equal(secondError, undefined);
        assert.equal(firstOutcome.created, true);
        assert.equal(secondOutcome?.created, false);
        assert.equal(secondOutcome?.revision, firstOutcome.revision);
        assert.equal(rows.rows.length, 1);
        assert.equal(rows.rows[0].created_by, actorConcurrent);
        assert.ok(rows.rows[0].created_at);
        assert.equal(history.rows.length, 0);
      });
    } finally {
      await second?.query('rollback').catch(() => {});
      await first?.query('rollback').catch(() => {});
      await second?.end().catch(() => {});
      await first?.end().catch(() => {});
    }
  } finally {
    await owner?.end().catch(() => {});
    await engine.stop().catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let passed = 0;
  await propertyVendorLinksConcurrency({
    root: process.env.SGN_PROJECT_ROOT || process.cwd(),
    check: async (name, fn) => {
      await fn();
      passed += 1;
      console.log('PASS', name);
    },
  });
  console.log(`${passed} assertions passed`);
}
