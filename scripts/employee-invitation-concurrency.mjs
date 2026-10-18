import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { applyEmbeddedSchema } from './embedded-schema.mjs';

// Issue #68: two genuinely independent connections invite the same address at the same time.
// PGlite hosts one session, so this runs against the embedded real PostgreSQL engine. The
// per-address advisory lock must make the second caller wait for the first commit and then
// resume the recorded invitation instead of creating a second person or a conflicting role.
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

export async function employeeInvitationConcurrency({ root, check }) {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sgn68-pg-'));
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
    const adminA = '92000000-0000-4000-8000-0000000000c1';
    const adminB = '92000000-0000-4000-8000-0000000000c2';
    await owner.query('insert into auth.users values ($1),($2)', [
      adminA,
      adminB,
    ]);
    await owner.query(
      'insert into public.employees(id,auth_user_id,email,display_name,role,is_active) ' +
        "values ($1,$1,'invite-race-admin-a@example.test','Race Admin A','admin',true)," +
        " ($2,$2,'invite-race-admin-b@example.test','Race Admin B','admin',true)",
      [adminA, adminB],
    );
    first = new pg.Client(connectionConfig);
    second = new pg.Client(connectionConfig);
    await first.connect();
    await second.connect();
    await second.query("set statement_timeout = '15s'");
    await first.query("select set_config('request.jwt.claim.sub',$1,false)", [
      adminA,
    ]);
    await second.query("select set_config('request.jwt.claim.sub',$1,false)", [
      adminB,
    ]);
    const begin = 'select public.begin_employee_invitation($1,$2,$3) as result';

    // --- Same address, same role -----------------------------------------------------------
    const email = 'invite-race@example.test';
    await first.query('begin');
    await second.query('begin');
    const winner = await first.query(begin, [email, 'sales', randomUUID()]);
    let settled = false;
    const loser = second.query(begin, [email, 'sales', randomUUID()]).then(
      (value) => {
        settled = true;
        return value;
      },
      (error) => {
        settled = true;
        return error;
      },
    );
    await sleep(750);
    const waited = !settled;
    await first.query('commit');
    const outcome = await loser;
    await second.query('commit').catch(() => {});
    const rows = await owner.query(
      'select (select count(*)::int from public.employees where email=$1) as employees,' +
        ' (select count(*)::int from public.employee_invitations where email=$1) as invitations,' +
        ' (select actor_id::text from public.employee_invitations where email=$1) as actor',
      [email],
    );
    await check(
      'a second independent session waits for the first invitation instead of duplicating it',
      () => {
        assert.equal(
          waited,
          true,
          'the second call must wait on the address lock',
        );
        assert.equal(outcome?.error, undefined, JSON.stringify(outcome?.error));
        assert.equal(
          outcome.rows[0].result.id,
          winner.rows[0].result.id,
          'the second caller resumes the recorded invitation',
        );
      },
    );
    await check(
      'one concurrent pair leaves exactly one invited person and one invitation under the first actor',
      () => {
        assert.deepEqual(rows.rows, [
          { employees: 1, invitations: 1, actor: adminA },
        ]);
      },
    );

    // --- Same address, conflicting role ----------------------------------------------------
    const conflicting = 'invite-race-conflict@example.test';
    await first.query('begin');
    await second.query('begin');
    await first.query(begin, [conflicting, 'sales', randomUUID()]);
    settled = false;
    const conflictingCall = second
      .query(begin, [conflicting, 'admin', randomUUID()])
      .then(
        (value) => {
          settled = true;
          return value;
        },
        (error) => {
          settled = true;
          return error;
        },
      );
    await sleep(750);
    const conflictingWaited = !settled;
    await first.query('commit');
    const conflicted = await conflictingCall;
    await second.query('rollback').catch(() => {});
    const conflictingRows = await owner.query(
      'select role from public.employee_invitations where email=$1',
      [conflicting],
    );
    await check(
      'a concurrent invitation for a different role cannot change the recorded role',
      () => {
        assert.equal(conflictingWaited, true, 'the second call must wait');
        assert.equal(conflicted?.code, 'P0022');
        assert.deepEqual(conflictingRows.rows, [{ role: 'sales' }]);
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
