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

export async function employeeDeactivationConcurrency({ root, check }) {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sgn66-pg-'));
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
    const adminA = '96000000-0000-4000-8000-0000000000a1';
    const adminB = '96000000-0000-4000-8000-0000000000a2';
    await owner.query('insert into auth.users values ($1),($2)', [
      adminA,
      adminB,
    ]);
    await owner.query(
      'insert into public.employees(id,auth_user_id,email,display_name,role,is_active) ' +
        "values ($1,$1,'concurrency-admin-a@example.test','Concurrency Admin A','admin',true)," +
        " ($2,$2,'concurrency-admin-b@example.test','Concurrency Admin B','admin',true)",
      [adminA, adminB],
    );
    first = new pg.Client(connectionConfig);
    second = new pg.Client(connectionConfig);
    await first.connect();
    await second.connect();
    await second.query("set statement_timeout = '15s'");
    await first.query('begin');
    await second.query('begin');
    await first.query(
      'update public.employees set is_active=false where id=$1',
      [adminA],
    );
    let settled = false;
    const secondRemoval = second
      .query('update public.employees set is_active=false where id=$1', [
        adminB,
      ])
      .then(
        () => {
          settled = true;
        },
        (error) => {
          settled = true;
          return error;
        },
      );
    await sleep(750);
    const waited = !settled;
    await first.query('commit');
    const outcome = await secondRemoval;
    await second.query('rollback').catch(() => {});
    const remaining = await owner.query(
      "select id::text as id from public.employees where role = 'admin' and is_active",
    );
    await check(
      'a second live session cannot remove the remaining active admin while the first removal is uncommitted',
      () => {
        assert.equal(
          waited,
          true,
          'the second removal must wait on the advisory lock',
        );
        assert.equal(outcome?.code, 'P0010');
      },
    );
    await check(
      'the serialized last-admin race commits one removal and leaves exactly one active admin',
      () => {
        assert.equal(remaining.rows.length, 1);
        assert.equal(remaining.rows[0].id, adminB);
      },
    );
  } finally {
    await second?.end().catch(() => {});
    await first?.end().catch(() => {});
    await owner?.end().catch(() => {});
    await engine.stop().catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}
