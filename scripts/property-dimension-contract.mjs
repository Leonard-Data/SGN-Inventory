import assert from 'node:assert/strict';
import { parseAreaPair } from './import-legacy-sheet.mjs';

// The legacy sheet rounded Chiều ngang and Chiều dài to whole metres while Tổng diện tích kept
// the real pair, so 7,541 imported properties stored a frontage or depth that contradicts their
// own area text. Production was corrected from the area text; this is the audit that reports any
// record a future import brings back, by row rather than by count.
export async function propertyDimensionContract({ db, check, employees }) {
  const offenders = async () => {
    const rows = (
      await db.query(
        `select id, property_code, area_raw, frontage_m, depth_m
           from public.properties where area_raw is not null
          order by property_code, id`,
      )
    ).rows;
    const found = [];
    for (const row of rows) {
      // No pair in the area text, a zero pair, or no stored dimension has nothing to contradict.
      const pair = parseAreaPair(row.area_raw, 999999.99);
      for (const column of ['frontage_m', 'depth_m']) {
        if (row[column] === null || pair[column] === null) continue;
        if (Number(row[column]) !== Number(pair[column]))
          found.push(
            `${row.property_code ?? row.id}: ${column} is ${row[column]} but area text "${row.area_raw}" says ${pair[column]}`,
          );
      }
    }
    return found;
  };
  const reports = (found) =>
    assert.deepEqual(
      found,
      [],
      `stored dimensions contradict their area text:\n${found.join('\n')}`,
    );

  const matching = '20000000-0000-4000-8000-00000000d001';
  const unpaired = '20000000-0000-4000-8000-00000000d002';
  const zeroPair = '20000000-0000-4000-8000-00000000d003';
  await db.query(
    `insert into public.properties(id,property_code,listing_mode,status,created_by,land_area_m2,frontage_m,depth_m,area_raw) values
       ($1,'SGN-DIM-1','sale','available',$4,'80','4.5','16','80m2 (4,5m x16m)'),
       ($2,'SGN-DIM-2','sale','available',$4,'47.4','5',null,'47,4m²'),
       ($3,'SGN-DIM-3','sale','available',$4,null,'5',null,'0m2 (0m x0m)')`,
    [matching, unpaired, zeroPair, employees[0]],
  );

  await check(
    'a stored dimension that matches its area text, or has no pair, is no contradiction',
    async () => reports(await offenders()),
  );

  await check(
    'a rounded frontage or depth against its area text is reported by row',
    async () => {
      await db.query('update public.properties set frontage_m=$2 where id=$1', [
        matching,
        '5',
      ]);
      const frontage = await offenders();
      assert.equal(frontage.length, 1);
      assert.match(frontage[0], /SGN-DIM-1/);
      assert.match(frontage[0], /frontage_m is 5/);
      assert.match(frontage[0], /4\.5/);
      await db.query(
        'update public.properties set frontage_m=$2,depth_m=$3 where id=$1',
        [matching, '4.5', '20'],
      );
      const depth = await offenders();
      assert.equal(depth.length, 1);
      assert.match(depth[0], /depth_m is 20/);
      assert.match(depth[0], /16/);
      await db.query('update public.properties set depth_m=$2 where id=$1', [
        matching,
        '16',
      ]);
      reports(await offenders());
    },
  );
}
