import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
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

async function asAuthenticated(client, authUserId) {
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [
    authUserId,
  ]);
  await client.query('set role authenticated');
}

export async function propertyVendorLinkConcurrency({ root, check }) {
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
  const authA = '97000000-0000-4000-8000-0000000000a1';
  const authB = '97000000-0000-4000-8000-0000000000a2';
  const employeeA = '98000000-0000-4000-8000-0000000000a1';
  const employeeB = '98000000-0000-4000-8000-0000000000a2';
  const property = '27000000-0000-4000-8000-0000000000a1';
  const vendor = '37000000-0000-4000-8000-0000000000a1';
  let owner;
  let first;
  let second;
  try {
    await engine.initialise();
    await engine.start();
    owner = new pg.Client(connectionConfig);
    await owner.connect();
    await applyEmbeddedSchema({
      root,
      exec: (sql) => owner.query(sql),
    });
    await owner.query('insert into auth.users values ($1),($2)', [
      authA,
      authB,
    ]);
    await owner.query(
      'insert into public.employees(id,auth_user_id,email,display_name,role,is_active) ' +
        "values ($1,$2,'vendor-race-a@example.test','Vendor Race A','sales',true)," +
        " ($3,$4,'vendor-race-b@example.test','Vendor Race B','sales',true)",
      [employeeA, authA, employeeB, authB],
    );
    await owner.query(
      "insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-RACE-1','sale','available',$2)",
      [property, employeeA],
    );
    await owner.query(
      'insert into public.vendors(id,display_name,created_by,submission_key) values($1,$2,$3,$4)',
      [vendor, 'Công ty Vendor Race', employeeA, randomUUID()],
    );

    first = new pg.Client(connectionConfig);
    second = new pg.Client(connectionConfig);
    await first.connect();
    await second.connect();
    await asAuthenticated(first, authA);
    await asAuthenticated(second, authB);
    await second.query("set statement_timeout = '15s'");
    await first.query('begin');
    await second.query('begin');

    const link =
      'select public.link_property_vendor($1,$2,(select revision from public.properties where id=$1)) as link';
    const firstOutcome = (await first.query(link, [property, vendor])).rows[0]
      .link;
    let secondSettled = false;
    let secondOutcome = null;
    let secondError = null;
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
      'select property_id,vendor_id from public.property_vendors where property_id=$1 and vendor_id=$2',
      [property, vendor],
    );
    const history = await owner.query(
      "select target,actor_id,changed_fields from public.property_history where property_id=$1 and target='vendor_link'",
      [property],
    );

    await check(
      'a concurrent second link waits for the first transaction',
      () => {
        assert.equal(waited, true);
      },
    );
    await check(
      'two authenticated link sessions converge on one current row without property history',
      () => {
        assert.equal(secondError, null);
        assert.equal(firstOutcome.created, true);
        assert.equal(secondOutcome?.created, false);
        assert.equal(secondOutcome?.revision, firstOutcome.revision);
        assert.equal(rows.rows.length, 1);
        assert.equal(history.rows.length, 0);
      },
    );
  } finally {
    await second?.query('rollback').catch(() => {});
    await first?.query('rollback').catch(() => {});
    await second?.end().catch(() => {});
    await first?.end().catch(() => {});
    await owner?.end().catch(() => {});
    await engine.stop().catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}
