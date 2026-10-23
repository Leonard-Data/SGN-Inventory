import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { RequestError } from '../employees/api.ts';
import { createAfterWarning } from './create-duplicate.ts';

const form = readFileSync(new URL('./create.tsx', import.meta.url), 'utf8');

const match = { id: 'property-1', propertyCode: 'SGN-00000001' };
const address = { format: 'current', house_number: '12' };

// A match holds the save so the person can open the records, and the submit that follows the
// warning is the one deliberate confirmation: it asks nothing again and creates exactly once.
test('one confirmation after the warning creates exactly once', async () => {
  let asked = 0;
  let created = 0;
  const find = async () => {
    asked += 1;
    return [match];
  };
  const create = async () => {
    created += 1;
    return { id: 'property-2' };
  };

  assert.deepEqual(await createAfterWarning(find, address, null, create), {
    matches: [match],
  });
  assert.equal(created, 0);
  assert.equal(asked, 1);

  assert.deepEqual(await createAfterWarning(find, address, [match], create), {
    created: { id: 'property-2' },
  });
  assert.equal(created, 1);
  assert.equal(asked, 1);
});

test('an address nobody records adds no step', async () => {
  let created = 0;
  assert.deepEqual(
    await createAfterWarning(
      async () => [],
      address,
      null,
      async () => {
        created += 1;
        return { id: 'property-2' };
      },
    ),
    { created: { id: 'property-2' } },
  );
  assert.equal(created, 1);
});

// The warning informs; it never blocks. A check that could not be answered is no warning, so the
// creation goes on exactly as it did before this warning existed.
test('a check that failed is not a warning', async () => {
  const readFailure = async () => {
    throw new RequestError(503, 'unavailable');
  };
  assert.deepEqual(
    await createAfterWarning(readFailure, address, null, async () => 'created'),
    { created: 'created' },
  );
  const lost = async () => {
    throw new Error('network');
  };
  assert.deepEqual(
    await createAfterWarning(lost, address, null, async () => 'created'),
    { created: 'created' },
  );
});

test('a session that is gone is reported, not turned into a warning', async () => {
  for (const status of [401, 403]) {
    const denied = async () => {
      throw new RequestError(status, 'access-denied');
    };
    assert.deepEqual(
      await createAfterWarning(denied, address, null, async () => 'created'),
      { denied: status },
    );
  }
});

// The warning is the highlight, not a line inside the form: the match list opens the application's
// own modal, which names the records and offers the deliberate confirm, and that confirm is the
// form's own submission - the one path that creates exactly once.
test('a match opens the modal warning, whose confirm submits the form', async () => {
  assert.match(form, /<DetailActionDialog/);
  assert.match(form, /title=\{text\.duplicateAddressTitle\}/);
  assert.match(form, /open=\{Boolean\(duplicates\?\.length\)\}/);
  assert.match(form, /onClose=\{\(\) => setDuplicates\(null\)\}/);
  // The records that already hold the address, each one a link that opens it.
  assert.match(form, /duplicates\?\.map/);
  assert.match(form, /href=\{'\/properties\/' \+ match\.id\}/);
  // The deliberate confirmation, and backing out of it without creating anything.
  assert.match(form, /formRef\.current\?\.requestSubmit\(\)/);
  assert.match(form, /text\.createAnyway/);
  assert.match(form, /text\.createBack/);
  // The warning sits inside the dialog, in the same attention block the form used to hold it in.
  assert.match(
    form,
    /<DetailActionDialog[\s\S]*className="alert"[\s\S]*text\.duplicateAddressHint[\s\S]*<\/DetailActionDialog>/,
  );
});
