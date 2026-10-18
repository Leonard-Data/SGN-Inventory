import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';

// Issue #147 embedded regressions: the shared-address group read, the deliberate merge that
// moves linked records onto the most complete property and retires exactly the intended ones,
// the role boundary, and the retired record leaving the group. Real browser/API acceptance on a
// hosted project stays a staging gate; this proves the database rules the application relies on.
export async function addressDuplicateMergeContract({
  db,
  asUser,
  check,
  fails,
  employees,
  validationKey,
}) {
  const shared =
    '12/3 Nguyễn Thị Minh Khai, Phường 5, Quận 3, Thành phố Hồ Chí Minh';
  // The same recorded address written without accents and in lower case must match, because
  // address equality is the normalisation inventory search already uses.
  const sharedUnaccented =
    '12/3 nguyen thi minh khai, phuong 5, quan 3, thanh pho ho chi minh';
  const uniqueAddress = '99 Lê Lợi, Phường 1, Quận 1, Thành phố Hồ Chí Minh';
  const keep = 'a1000000-0000-4000-8000-000000000001';
  const duplicate = 'a1000000-0000-4000-8000-000000000002';
  const alone = 'a1000000-0000-4000-8000-000000000003';
  const second = 'a1000000-0000-4000-8000-000000000004';
  const keepFile = 'a2000000-0000-4000-8000-000000000001';
  const duplicateFile = 'a2000000-0000-4000-8000-000000000002';
  const keepContact = 'a3000000-0000-4000-8000-000000000001';
  const duplicateContact = 'a3000000-0000-4000-8000-000000000002';

  // Fixture and inspection writes: drop both the role and the request claim, so the employee
  // guard and the immutable-record guards see an owner connection.
  const asOwner = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  const group = async (id) =>
    (await db.query('select public.property_address_group($1) as grp', [id]))
      .rows[0].grp;
  const snapshot = async () => {
    const read = async (sql) => Number((await db.query(sql)).rows[0].n);
    return {
      archived: await read(
        'select count(*)::int as n from public.properties where archived_at is not null',
      ),
      links: await read(
        'select count(*)::int as n from public.property_contacts',
      ),
      files: await read('select count(*)::int as n from public.property_files'),
      history: await read(
        'select count(*)::int as n from public.property_history',
      ),
      addresses: await read(
        'select count(*)::int as n from public.property_addresses',
      ),
    };
  };

  await asOwner();
  await db.query(
    `insert into public.properties(id,property_code,listing_mode,property_type,status,
       sale_price_vnd,land_area_m2,floor_area_m2,frontage_m,depth_m,floors,bedrooms,notes,ownership_type,created_by)
     values ($1,'SGN147-A','sale','house','available',12000000000,120.5,240.25,6,20,3,4,'Most complete record','individual',$2),
            ($3,'SGN147-B','sale','house','negotiating',9000000000,100,200,5,20,2,3,null,null,$2),
            ($4,'SGN147-C','rent','apartment','available',null,60,60,null,null,null,2,null,null,$2),
            ($5,'SGN147-D','sale','house','available',7000000000,null,null,null,null,null,null,null,null,$2)`,
    [keep, employees[0], duplicate, alone, second],
  );
  await db.query(
    `insert into public.property_addresses(property_id,format,address_text) values
       ($1,'legacy',$5),($2,'legacy',$6),($3,'legacy',$7),($4,'legacy',$8)`,
    [
      keep,
      duplicate,
      alone,
      second,
      shared,
      sharedUnaccented,
      uniqueAddress,
      shared,
    ],
  );
  await db.query(
    `insert into public.contacts(id,display_name,phones,contact_type) values
       ($1,'Owner on the kept record','{0901111111}','owner'),
       ($2,'Owner on the folded record','{0902222222}','owner')`,
    [keepContact, duplicateContact],
  );
  await db.query(
    `insert into public.property_contacts(property_id,contact_id,relation,is_primary) values
       ($1,$2,'owner',true),($3,$4,'owner',true),($5,$4,'owner',true)`,
    [keep, keepContact, duplicate, duplicateContact, second],
  );
  const fileRow = `insert into public.property_files(
      id,property_id,document_type,bucket_id,object_path,original_filename,mime_type,
      size_bytes,sha256,purpose,upload_status,uploaded_by,validated_at,validated_object_id)
    values ($1,$2,'other','property-files',$3,'contract.pdf','application/pdf',1024,
      repeat('a',64),'document','ready',$4,now(),$5)`;
  await db.query(fileRow, [
    keepFile,
    keep,
    `${keep}/${keepFile}/content`,
    employees[0],
    randomUUID(),
  ]);
  await db.query(fileRow, [
    duplicateFile,
    duplicate,
    `${duplicate}/${duplicateFile}/content`,
    employees[0],
    randomUUID(),
  ]);
  // The folded record owns the only cover, and one recorded asking-price change.
  await db.query('update public.properties set cover_file_id=$1 where id=$2', [
    duplicateFile,
    duplicate,
  ]);
  await db.query(
    `insert into public.property_history(property_id,actor_id,actor_name,target,target_id,
       changed_fields,before_values,after_values)
     values ($1,$2,'Fixture sales','property',$1,array['sale_price_vnd'],
       '{"sale_price_vnd":"8000000000"}','{"sale_price_vnd":"9000000000"}')`,
    [duplicate, employees[0]],
  );

  await asUser(0);
  const full = await group(keep);
  await check('a shared address reports the whole group', async () => {
    assert.equal(full.members.length, 3);
    assert.deepEqual(full.members.map((member) => member.propertyCode).sort(), [
      'SGN147-A',
      'SGN147-B',
      'SGN147-D',
    ]);
    // The most complete record is named as the one the merge would keep.
    assert.equal(full.keepId, keep);
    const folded = full.members.find((member) => member.id === duplicate);
    assert.equal(folded.salePriceVnd, '9000000000');
    assert.deepEqual(folded.owners, ['Owner on the folded record']);
  });
  await check('a unique address forms no group', async () => {
    const single = await group(alone);
    assert.equal(single.members.length, 1);
    assert.equal(single.members[0].id, alone);
  });
  const before = await snapshot();
  await check('comparing the group changes nothing (keep both)', async () => {
    await group(keep);
    await group(duplicate);
    assert.deepEqual(await snapshot(), before);
  });
  await check('anonymous group read denied', async () => {
    await asUser(null);
    await fails('select public.property_address_group($1)', [keep], '42501');
  });
  await check('anonymous merge denied', async () => {
    await asUser(null);
    await fails(
      'select public.merge_address_properties($1,array[$2]::uuid[],array[]::uuid[])',
      [keep, duplicate],
      '42501',
    );
  });
  await check('inactive employee merge denied', async () => {
    await asUser(4);
    await fails(
      'select public.merge_address_properties($1,array[$2]::uuid[],array[]::uuid[])',
      [keep, duplicate],
      '42501',
    );
  });
  await check('ordinary employee cannot merge', async () => {
    await asUser(0);
    await fails(
      'select public.merge_address_properties($1,array[$2]::uuid[],array[]::uuid[])',
      [keep, duplicate],
      '42501',
    );
  });
  await check('staff cannot merge', async () => {
    await asUser(5);
    await fails(
      'select public.merge_address_properties($1,array[$2]::uuid[],array[]::uuid[])',
      [keep, duplicate],
      '42501',
    );
  });
  await asUser(2);
  await check(
    'merge refuses a target that is not the most complete record',
    () =>
      fails(
        'select public.merge_address_properties($1,array[$2]::uuid[],array[]::uuid[])',
        [duplicate, keep],
        'P0008',
      ),
  );
  await check('merge refuses records that do not share the address', () =>
    fails(
      'select public.merge_address_properties($1,array[$2]::uuid[],array[]::uuid[])',
      [keep, 'a1000000-0000-4000-8000-000000000003'],
      'P0009',
    ),
  );
  await check('merge refuses a ready file with no attested move', () =>
    fails(
      'select public.merge_address_properties($1,array[$2]::uuid[],array[]::uuid[])',
      [keep, duplicate],
      'P0016',
    ),
  );
  const copiedObjectId = randomUUID();
  await check(
    'a claimed file move without the server attestation is refused and nothing moves',
    async () => {
      await fails(
        'select public.merge_address_properties($1,array[$2]::uuid[],array[$3]::uuid[],$4)',
        [keep, duplicate, copiedObjectId, '0'.repeat(64)],
        'P0018',
      );
      const file = (
        await db.query(
          'select property_id,object_path from public.property_files where id=$1',
          [duplicateFile],
        )
      ).rows[0];
      assert.equal(file.property_id, duplicate);
      assert.equal(file.object_path, `${duplicate}/${duplicateFile}/content`);
      const retired = (
        await db.query(
          'select archived_at from public.properties where id=$1',
          [duplicate],
        )
      ).rows[0];
      assert.equal(retired.archived_at, null);
    },
  );
  await check('direct client file identity change is still refused', () =>
    fails(
      'update public.property_files set property_id=$1,object_path=$2 where id=$3',
      [keep, `${keep}/${duplicateFile}/content`, duplicateFile],
      '42501',
    ),
  );

  const signature = createHmac('sha256', Buffer.from(validationKey, 'hex'))
    .update(
      [
        'v1',
        'merge',
        keep,
        duplicateFile,
        `${keep}/${duplicateFile}/content`,
        copiedObjectId,
      ].join('|'),
    )
    .digest('hex');
  const report = (
    await db.query(
      'select public.merge_address_properties($1,array[$2,$3]::uuid[],array[$4]::uuid[],$5) as report',
      [keep, duplicate, second, copiedObjectId, signature],
    )
  ).rows[0].report;
  await check(
    'merge moves the linked records and reports exactly what moved',
    async () => {
      assert.equal(report.keep.propertyCode, 'SGN147-A');
      assert.deepEqual(
        report.merged.map((row) => row.propertyCode),
        ['SGN147-B', 'SGN147-D'],
      );
      assert.deepEqual(report.moved, {
        files: 1,
        ownerLinks: 1,
        alreadyLinked: 0,
        history: 1,
      });
    },
  );
  await check(
    'the moved rows now belong to the surviving property',
    async () => {
      const file = (
        await db.query(
          'select property_id,object_path from public.property_files where id=$1',
          [duplicateFile],
        )
      ).rows[0];
      assert.equal(file.property_id, keep);
      assert.equal(file.object_path, `${keep}/${duplicateFile}/content`);
      // The contact linked to both folded records keeps exactly one row on the survivor; the
      // duplicate stays with the archived record instead of violating the property-contacts key.
      const link = (
        await db.query(
          'select property_id,is_primary from public.property_contacts where contact_id=$1 order by property_id',
          [duplicateContact],
        )
      ).rows;
      assert.deepEqual(link, [
        { property_id: keep, is_primary: false },
        { property_id: second, is_primary: true },
      ]);
      const history = (
        await db.query(
          'select count(*)::int as n from public.property_history where property_id=$1',
          [duplicate],
        )
      ).rows[0].n;
      assert.equal(history, 0);
      const cover = (
        await db.query(
          'select cover_file_id from public.properties where id=$1',
          [keep],
        )
      ).rows[0].cover_file_id;
      assert.equal(cover, duplicateFile);
      const retired = (
        await db.query(
          'select archived_at,cover_file_id from public.properties where id=$1',
          [duplicate],
        )
      ).rows[0];
      assert.ok(retired.archived_at);
      assert.equal(retired.cover_file_id, null);
    },
  );
  await check('exactly the intended record was retired', async () => {
    const rows = (
      await db.query(
        'select id,archived_at from public.properties where id in ($1,$2,$3,$4) order by property_code',
        [keep, duplicate, alone, second],
      )
    ).rows;
    assert.deepEqual(
      rows.map((row) => [row.id, row.archived_at === null]),
      [
        [keep, true],
        [duplicate, false],
        [alone, true],
        [second, false],
      ],
    );
  });
  await asUser(0);
  await check(
    'a merged-away record no longer reports as a duplicate',
    async () => {
      const kept = await group(keep);
      assert.equal(kept.members.length, 1);
      const retired = await group(duplicate);
      assert.deepEqual(retired, { keepId: null, members: [] });
    },
  );
  await asUser(2);
  await check('an archived record cannot be merged again', () =>
    fails(
      'select public.merge_address_properties($1,array[$2]::uuid[],array[]::uuid[])',
      [keep, duplicate],
      'P0017',
    ),
  );
  await asOwner();
}
