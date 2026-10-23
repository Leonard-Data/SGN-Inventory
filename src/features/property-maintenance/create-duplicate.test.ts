import assert from 'node:assert/strict';
import test from 'node:test';
import { RequestError } from '../employees/api.ts';
import { createAfterWarning } from './create-duplicate.ts';

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
