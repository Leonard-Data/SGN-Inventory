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

// Ticket #72: staff/manager/admin link, wrong-person replacement, primary replacement and
// unlink share the existing `maintain_property(...,'link',...)` operation. This module proves
// two real separate-session races on a live embedded PostgreSQL engine: a link change that
// waited on the shared maintenance gate re-checks live membership before writing, and a
// concurrent primary replacement is refused on a stale parent revision rather than
// overwriting the newer relationship, leaving at most one primary contact.
export async function contactLinksConcurrency({ root, check }) {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sgn72-pg-'));
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

    const actorLink = '97000000-0000-4000-8000-0000000000b1';
    const actorPrimaryFirst = '97000000-0000-4000-8000-0000000000b2';
    const actorPrimarySecond = '97000000-0000-4000-8000-0000000000b3';
    const property = '27000000-0000-4000-8000-0000000000b1';
    const contactA = '37000000-0000-4000-8000-0000000000b1';
    const contactB = '37000000-0000-4000-8000-0000000000b2';
    const propertyRevision = randomUUID();
    await owner.query('insert into auth.users values ($1),($2),($3)', [
      actorLink,
      actorPrimaryFirst,
      actorPrimarySecond,
    ]);
    await owner.query(
      "insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ($1,$1,'link-race@example.test','Link Race','staff',true), ($2,$2,'primary-first@example.test','Primary First','staff',true), ($3,$3,'primary-second@example.test','Primary Second','staff',true)",
      [actorLink, actorPrimaryFirst, actorPrimarySecond],
    );
    await owner.query(
      "insert into public.properties(id,property_code,listing_mode,status,created_by,revision) values ($1,'SGN-LINK-RACE','sale','available',$2,$3)",
      [property, actorLink, propertyRevision],
    );
    for (const [id, name] of [
      [contactA, 'Race Contact A'],
      [contactB, 'Race Contact B'],
    ])
      await owner.query(
        "insert into public.contacts(id,display_name,contact_type) values ($1,$2,'unknown')",
        [id, name],
      );

    // A link create that waited on the gate re-reads live membership (and the staff role)
    // after the gate releases, so a session deactivated mid-wait writes no link and no
    // property history.
    {
      let first;
      let second;
      try {
        first = new pg.Client(connectionConfig);
        second = new pg.Client(connectionConfig);
        await first.connect();
        await second.connect();
        await second.query(
          "select set_config('request.jwt.claim.sub',$1,false)",
          [actorLink],
        );
        await second.query('set role authenticated');
        await first.query('begin');
        await first.query('select private.maintenance_gate()');
        await second.query('begin');
        let settled = false;
        const pending = second
          .query('select public.maintain_property($1,$2,$3,$4,$5,$6)', [
            property,
            'link',
            null,
            propertyRevision,
            JSON.stringify({ contact_id: contactA, relation: 'owner' }),
            propertyRevision,
          ])
          .then(
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
        await first.query(
          'update public.employees set is_active=false where id=$1',
          [actorLink],
        );
        await first.query('commit');
        const outcome = await pending;
        await second.query('rollback').catch(() => {});
        await check(
          'a contact link change rechecks live membership before writing the link or history',
          async () => {
            assert.equal(
              waited,
              true,
              'the guarded call must wait on the maintenance gate',
            );
            assert.equal(outcome?.code, '42501');
            assert.deepEqual(
              (
                await owner.query(
                  'select property_id,contact_id from public.property_contacts where property_id=$1',
                  [property],
                )
              ).rows,
              [],
            );
            assert.deepEqual(
              (
                await owner.query(
                  'select target,target_id from public.property_history where property_id=$1',
                  [property],
                )
              ).rows,
              [],
            );
          },
        );
      } finally {
        await second?.end().catch(() => {});
        await first?.end().catch(() => {});
      }
    }

    // Two primary replacements from separate sessions serialize behind the maintenance gate.
    // The first writer changes the property's record-review flag (and therefore its parent
    // revision), so the second session's stale parent revision is refused with PT409 instead
    // of overwriting the newer relationship; exactly one primary remains.
    {
      let first;
      let second;
      try {
        first = new pg.Client(connectionConfig);
        second = new pg.Client(connectionConfig);
        await first.connect();
        await second.connect();
        await owner.query(
          'insert into public.property_contacts(property_id,contact_id,relation,is_primary) values ($1,$2,$3,false),($1,$4,$3,false)',
          [property, contactA, 'owner', contactB],
        );
        const revisionOf = async (contact) =>
          (
            await owner.query(
              'select revision from public.property_contacts where property_id=$1 and contact_id=$2',
              [property, contact],
            )
          ).rows[0].revision;
        const revA = await revisionOf(contactA);
        const revB = await revisionOf(contactB);
        for (const [client, actor] of [
          [first, actorPrimaryFirst],
          [second, actorPrimarySecond],
        ]) {
          await client.query(
            "select set_config('request.jwt.claim.sub',$1,false)",
            [actor],
          );
          await client.query('set role authenticated');
        }
        await first.query('begin');
        await second.query('begin');
        await first.query(
          'select public.maintain_property($1,$2,$3,$4,$5,$6)',
          [
            property,
            'link',
            contactA,
            revA,
            JSON.stringify({ is_primary: true }),
            propertyRevision,
          ],
        );
        let secondSettled = false;
        let secondError;
        const secondRequest = second
          .query('select public.maintain_property($1,$2,$3,$4,$5,$6)', [
            property,
            'link',
            contactB,
            revB,
            JSON.stringify({ is_primary: true }),
            propertyRevision,
          ])
          .then(
            () => {
              secondSettled = true;
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
        await second.query('rollback').catch(() => {});
        const primaries = await owner.query(
          'select contact_id from public.property_contacts where property_id=$1 and is_primary',
          [property],
        );
        await check(
          'a concurrent primary replacement is refused on a stale parent revision and keeps one primary',
          () => {
            assert.equal(waited, true);
            assert.equal(secondError?.code, 'PT409');
            assert.equal(primaries.rows.length, 1);
            assert.equal(primaries.rows[0].contact_id, contactA);
          },
        );
      } finally {
        await second?.query('rollback').catch(() => {});
        await first?.query('rollback').catch(() => {});
        await second?.end().catch(() => {});
        await first?.end().catch(() => {});
      }
    }
  } finally {
    await owner?.end().catch(() => {});
    await engine.stop().catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let passed = 0;
  await contactLinksConcurrency({
    root: process.env.SGN_PROJECT_ROOT || process.cwd(),
    check: async (name, fn) => {
      await fn();
      passed += 1;
      console.log('PASS', name);
    },
  });
  console.log(`${passed} assertions passed`);
}
