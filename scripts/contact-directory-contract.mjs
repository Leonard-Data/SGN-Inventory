import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Ticket #71 embedded regressions: the shared Contact directory read and its
// contact-scoped correction. It proves the database rules the directory surface depends on
// — recorded Owner membership from property relationships, bounded literal name paging, the
// archived affected-property boundary, one shared-identity operation that appends no
// property history row (issue #109) and unchanged direct-write/creation authority. Real
// Auth/Data API/browser acceptance remains a hosted gate.
//
// No direct shared-contact correction leaves an actor-bearing record in this slice: by the
// accepted consequence of issue #109 the correction changes the shared person and raises the
// pending review flag, and the correction-request record stays the who/what/when path for
// proposed changes. The rows below therefore assert the committed person, the affected set
// and the review flag instead of an actor on a history row.
export async function contactDirectoryContract({ db, asUser, check, fails }) {
  const list =
    'select * from public.list_contacts($1::text,$2::uuid,$3::boolean,$4::integer)';
  const impact = 'select public.contact_impact($1) as impact';
  const correct = 'select public.maintain_contact($1,$2,$3) as id';
  const mutate =
    'select public.maintain_property($1,$2,$3,$4,$5,(select revision from public.properties where id=$1)) as id';
  const createProperty = 'select public.create_property($1,$2,$3) as id';
  const createContact = 'select public.create_contact($1) as id';
  const revision = async (table, id) =>
    (await db.query(`select revision from public.${table} where id=$1`, [id]))
      .rows[0].revision;
  const properties = async (contact) =>
    (
      await db.query(
        'select property_id,relation,is_primary from public.property_contacts where contact_id=$1 order by property_id',
        [contact],
      )
    ).rows;
  const history = async (contact) =>
    (
      await db.query(
        "select property_id,actor_id,changed_fields,before_values,after_values from public.property_history where target='contact' and target_id=$1 order by property_id",
        [contact],
      )
    ).rows;
  const listed = async (query, ownersOnly) =>
    (await db.query(list, [query, null, ownersOnly, 31])).rows;

  // Fixture/inspection connection: drop the role and the request claim so the employee
  // guard sees an owner connection, which is the only connection allowed to insert the
  // paging fixture rows directly.
  const asOwner = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  // An authenticated identity with no linked employee row.
  const asIdentity = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      randomUUID(),
    ]);
    await db.exec('set role authenticated');
  };

  await check(
    'the directory read and the shared-identity correction are invoker wrappers with explicit grants',
    async () => {
      for (const signature of [
        'public.list_contacts(text,uuid,boolean,integer)',
        'public.maintain_contact(uuid,uuid,jsonb)',
      ]) {
        assert.equal(
          (
            await db.query(
              "select has_function_privilege('authenticated',$1::regprocedure,'EXECUTE') as allowed",
              [signature],
            )
          ).rows[0].allowed,
          true,
          signature,
        );
        assert.equal(
          (
            await db.query(
              "select has_function_privilege('anon',$1::regprocedure,'EXECUTE') as allowed",
              [signature],
            )
          ).rows[0].allowed,
          false,
          signature,
        );
        assert.equal(
          (
            await db.query(
              'select prosecdef from pg_proc where oid=$1::regprocedure',
              [signature],
            )
          ).rows[0].prosecdef,
          false,
          signature,
        );
      }
      // The guarded definer stays reachable from a client role only because the invoker
      // wrapper needs it; the private schema is not exposed and the function re-checks live
      // membership and role itself.
      assert.equal(
        (
          await db.query(
            "select has_function_privilege('authenticated','private.maintain_contact(uuid,uuid,jsonb)','EXECUTE') as allowed",
          )
        ).rows[0].allowed,
        true,
      );
      assert.equal(
        (
          await db.query(
            "select has_function_privilege('anon','private.maintain_contact(uuid,uuid,jsonb)','EXECUTE') as allowed",
          )
        ).rows[0].allowed,
        false,
      );
    },
  );

  let left;
  let right;
  let shared;
  await asUser(1);
  await check(
    'a salesperson reads the directory and corrects a linked shared identity from it',
    async () => {
      left = (
        await db.query(createProperty, [
          'sale',
          {},
          { format: 'legacy', address_text: 'SGN71 directory parent left' },
        ])
      ).rows[0].id;
      right = (
        await db.query(createProperty, [
          'sale',
          {},
          { format: 'legacy', address_text: 'SGN71 directory parent right' },
        ])
      ).rows[0].id;
      await asUser(5);
      shared = (
        await db.query(createContact, [
          {
            display_name: 'SGN71 Shared Person',
            phones: ['0900000001'],
            raw_phone_text: '0900 000 001',
          },
        ])
      ).rows[0].id;
      // Local link authority stays staff/manager/admin; the directory slice widens nothing.
      await db.query(mutate, [
        left,
        'link',
        null,
        await revision('properties', left),
        { contact_id: shared, relation: 'owner', is_primary: true },
      ]);
      await db.query(mutate, [
        right,
        'link',
        null,
        await revision('properties', right),
        { contact_id: shared, relation: 'broker' },
      ]);
      await asUser(0);
      // A recorded review flag is cleared first, so the correction's own effect on it is
      // observable rather than assumed to have been pending all along.
      await asUser(2);
      for (const propertyId of [left, right])
        await db.query(mutate, [
          propertyId,
          'property',
          propertyId,
          await revision('properties', propertyId),
          { record_review_status: 'approved' },
        ]);
      await asUser(0);
      const owners = await listed('SGN71 Shared Person', true);
      assert.equal(owners.length, 1);
      assert.deepEqual(
        Object.fromEntries(
          owners[0].links.map((row) => [row.property_id, row.relation]),
        ),
        { [left]: 'owner', [right]: 'broker' },
      );
      // One contact-scoped correction, no parent property, same operation as the property branch.
      const preview = (await db.query(impact, [shared])).rows[0].impact;
      assert.deepEqual(
        preview.properties.map((row) => row.id).sort(),
        [left, right].sort(),
      );
      await db.query(correct, [
        shared,
        preview.revision,
        {
          display_name: 'SGN71 Shared Person',
          phones: ['0900000002'],
          raw_phone_text: '0900 %_ 000 002',
        },
      ]);
      // The correction changes the shared person itself, which is the evidence a
      // directory-origin save leaves: a recorded shared-contact correction appends no
      // property history row (issue #109 narrowed `property_history` to asking prices).
      assert.deepEqual(
        (
          await db.query(
            'select display_name,phones,raw_phone_text from public.contacts where id=$1',
            [shared],
          )
        ).rows[0],
        {
          display_name: 'SGN71 Shared Person',
          phones: ['0900000002'],
          raw_phone_text: '0900 %_ 000 002',
        },
      );
      assert.deepEqual(await history(shared), []);
      // The affected set is unchanged and both linked properties keep the review flag the
      // shared correction still raises; nothing about the relationship moved.
      assert.deepEqual(
        Object.fromEntries(
          (await properties(shared)).map((row) => [
            row.property_id,
            row.relation,
          ]),
        ),
        { [left]: 'owner', [right]: 'broker' },
      );
      assert.deepEqual(
        (
          await db.query(
            'select id,record_review_status from public.properties where id in ($1,$2) order by id',
            [left, right],
          )
        ).rows.map((row) => row.record_review_status),
        ['pending', 'pending'],
      );
      // The corrected values are what a fresh property read presents on both properties.
      for (const propertyId of [left, right]) {
        const fresh = (
          await db.query(
            'select c.display_name,c.raw_phone_text from public.property_contacts pc join public.contacts c on c.id=pc.contact_id where pc.property_id=$1',
            [propertyId],
          )
        ).rows;
        assert.equal(fresh.length, 1);
        assert.equal(fresh[0].raw_phone_text, '0900 %_ 000 002');
      }
    },
  );

  await check(
    'Owner membership comes from the recorded relationship, not the identity classification',
    async () => {
      await asUser(5);
      const classifiedOwner = (
        await db.query(createContact, [
          { display_name: 'SGN71 Classified Owner', contact_type: 'owner' },
        ])
      ).rows[0].id;
      const classifiedBroker = (
        await db.query(createContact, [
          { display_name: 'SGN71 Classified Broker', contact_type: 'broker' },
        ])
      ).rows[0].id;
      await db.query(mutate, [
        left,
        'link',
        null,
        await revision('properties', left),
        { contact_id: classifiedOwner, relation: 'broker' },
      ]);
      await db.query(mutate, [
        right,
        'link',
        null,
        await revision('properties', right),
        { contact_id: classifiedBroker, relation: 'owner' },
      ]);
      await asUser(0);
      assert.equal((await listed('SGN71 Classified Owner', true)).length, 0);
      assert.equal((await listed('SGN71 Classified Owner', false)).length, 1);
      const owners = await listed('SGN71 Classified Broker', true);
      assert.equal(owners.length, 1);
      assert.equal(owners[0].contact_type, 'broker');
      assert.deepEqual(
        owners[0].links.map((row) => [row.property_id, row.relation]),
        [[right, 'owner']],
      );
    },
  );

  let archivedOwner;
  await asUser(2);
  await check(
    'an owner link on an archived property is outside the ordinary affected-property boundary',
    async () => {
      const hidden = (
        await db.query(createProperty, [
          'sale',
          {},
          { format: 'legacy', address_text: 'SGN71 archived parent' },
        ])
      ).rows[0].id;
      archivedOwner = (
        await db.query(createContact, [
          { display_name: 'SGN71 Archived Owner' },
        ])
      ).rows[0].id;
      await db.query(mutate, [
        hidden,
        'link',
        null,
        await revision('properties', hidden),
        { contact_id: archivedOwner, relation: 'owner' },
      ]);
      await db.query(mutate, [
        hidden,
        'property',
        hidden,
        await revision('properties', hidden),
        { archived_at: new Date().toISOString() },
      ]);
      // The reviewer sees the linked archived property and may correct through it.
      const reviewer = await listed('SGN71 Archived Owner', true);
      assert.equal(reviewer.length, 1);
      assert.deepEqual(
        reviewer[0].links.map((row) => [row.property_id, row.relation]),
        [[hidden, 'owner']],
      );
      await asUser(0);
      // An ordinary employee sees neither the owner membership nor the link, and the
      // shared operation refuses the incomplete affected set instead of leaking it.
      assert.equal((await listed('SGN71 Archived Owner', true)).length, 0);
      const visible = await listed('SGN71 Archived Owner', false);
      assert.equal(visible.length, 1);
      assert.deepEqual(visible[0].links, []);
      await fails(impact, [archivedOwner], 'PT403');
      await fails(
        correct,
        [
          archivedOwner,
          await revision('contacts', archivedOwner),
          { display_name: 'forged' },
        ],
        'PT403',
      );
    },
  );

  await asUser(5);
  await check(
    'an unlinked identity stays staff-only and a standalone directory edit invents no parent property',
    async () => {
      const unlinked = (
        await db.query(createContact, [
          { display_name: 'SGN71 Unlinked Person' },
        ])
      ).rows[0].id;
      // The identity is listed for every active employee; only correction is narrowed.
      await asUser(0);
      assert.equal((await listed('SGN71 Unlinked Person', false)).length, 1);
      assert.equal((await listed('SGN71 Unlinked Person', true)).length, 0);
      await fails(impact, [unlinked], 'PT403');
      await fails(
        correct,
        [
          unlinked,
          await revision('contacts', unlinked),
          { display_name: 'not allowed' },
        ],
        'PT403',
      );
      await asUser(5);
      await db.query(correct, [
        unlinked,
        await revision('contacts', unlinked),
        { display_name: 'SGN71 Unlinked Person', notes: 'staff correction' },
      ]);
      // A standalone directory edit supplies no parent property and none is invented: the
      // identity keeps no link and no property history row exists to point at one.
      assert.equal(
        (
          await db.query(
            'select count(*)::int as n from public.property_contacts where contact_id=$1',
            [unlinked],
          )
        ).rows[0].n,
        0,
      );
      assert.deepEqual(await history(unlinked), []);
      assert.equal(
        (
          await db.query('select notes from public.contacts where id=$1', [
            unlinked,
          ])
        ).rows[0].notes,
        'staff correction',
      );
    },
  );

  await check(
    'a stale or unchanged save is refused and records nothing',
    async () => {
      await asUser(0);
      const preview = (await db.query(impact, [shared])).rows[0].impact;
      const recorded = async () =>
        (
          await db.query(
            'select display_name,phones,raw_phone_text from public.contacts where id=$1',
            [shared],
          )
        ).rows[0];
      // A no-op correction commits nothing new and, per issue #109, leaves no history row.
      const before = await recorded();
      await db.query(correct, [
        shared,
        preview.revision,
        {
          display_name: before.display_name,
          phones: before.phones,
          raw_phone_text: before.raw_phone_text,
        },
      ]);
      assert.deepEqual(await recorded(), before);
      assert.deepEqual(await history(shared), []);
      // A changed affected set invalidates the preview the editor showed.
      await asUser(5);
      const extra = (
        await db.query(createContact, [{ display_name: 'SGN71 Extra Link' }])
      ).rows[0].id;
      await db.query(mutate, [
        left,
        'link',
        null,
        await revision('properties', left),
        { contact_id: extra, relation: 'representative' },
      ]);
      await asUser(0);
      await fails(
        correct,
        [shared, preview.revision, { raw_phone_text: 'stale directory save' }],
        'PT409',
      );
      assert.deepEqual(await recorded(), before);
      assert.deepEqual(await history(shared), []);
    },
  );

  await check(
    'the name query is a literal bounded fragment and paging is complete and deterministic',
    async () => {
      await asUser(5);
      const literal = (
        await db.query(createContact, [
          { display_name: 'SGN71 %_ literal person' },
        ])
      ).rows[0].id;
      const plain = (
        await db.query(createContact, [
          { display_name: 'SGN71 AB literal person' },
        ])
      ).rows[0].id;
      await asUser(0);
      // `%` and `_` are ordinary characters: the pattern must not widen the match. The
      // single `_` is spelled exactly as a wildcard would be, so a wildcard reading would
      // have matched both fixtures instead of none.
      const metacharacters = await listed('SGN71 %_', false);
      assert.deepEqual(
        metacharacters.map((row) => row.id),
        [literal],
      );
      assert.deepEqual(await listed('SGN71 _', false), []);
      assert.deepEqual(
        (await listed('SGN71 AB', false)).map((row) => row.id),
        [plain],
      );
      assert.equal((await listed('SGN71', false)).length > 0, true);
      // An over-long raw query is bounded to no rows rather than an unbounded scan.
      assert.deepEqual(await listed('a'.repeat(121), false), []);
      // The exposed page is at most 30 rows whatever the caller asks for.
      await asOwner();
      await db.query(
        "insert into public.contacts(display_name,phones) select 'SGN71 Page Fixture '||lpad(n::text,2,'0'),'{}'::text[] from generate_series(1,32) n",
      );
      await asUser(0);
      const first = await db.query(list, [
        'SGN71 Page Fixture',
        null,
        false,
        1000,
      ]);
      assert.equal(first.rows.length, 31);
      const second = await db.query(list, [
        'SGN71 Page Fixture',
        first.rows.at(-1).id,
        false,
        31,
      ]);
      const seen = [...first.rows, ...second.rows].map((row) => row.id);
      assert.equal(new Set(seen).size, seen.length);
      assert.equal(seen.length, 32);
      assert.equal(second.rows.length, 1);
      assert.equal((await listed('SGN71 Page Fixture', false)).length, 31);
    },
  );

  await check(
    'anonymous, unlinked and inactive callers reach neither the directory nor the operation',
    async () => {
      await asUser(null);
      await fails(list, [null, null, false, 31], '42501');
      await fails(impact, [shared], '42501');
      await fails(
        correct,
        [shared, randomUUID(), { notes: 'anonymous' }],
        '42501',
      );
      await asIdentity();
      assert.deepEqual(await listed(null, false), []);
      await fails(
        correct,
        [shared, randomUUID(), { notes: 'unlinked' }],
        '42501',
      );
      await asUser(4);
      assert.deepEqual(await listed(null, false), []);
      await fails(
        correct,
        [shared, randomUUID(), { notes: 'inactive' }],
        '42501',
      );
      await fails(impact, [shared], '42501');
    },
  );

  await check(
    'a direct shared-contact write stays denied while the directory operation is granted',
    async () => {
      await asUser(0);
      const before = (
        await db.query(
          'select notes,revision from public.contacts where id=$1',
          [shared],
        )
      ).rows[0];
      await fails(
        "update public.contacts set notes='forged' where id=$1",
        [shared],
        '42501',
      );
      const after = (
        await db.query(
          'select notes,revision from public.contacts where id=$1',
          [shared],
        )
      ).rows[0];
      assert.equal(after.notes, before.notes);
      assert.equal(after.revision, before.revision);
      assert.equal((await properties(shared)).length, 2);
    },
  );

  await asUser(null);
}
