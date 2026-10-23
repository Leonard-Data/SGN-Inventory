import assert from 'node:assert/strict';
import test from 'node:test';
import { RequestError } from '../employees/api.ts';
import { duplicateCheck } from './create-duplicate.ts';

const match = { id: 'property-1', propertyCode: 'SGN-00000001' };
const address = { format: 'current', house_number: '12' };

// A match holds the save so the person can open the records, and it is not asked again: the submit
// that follows the warning is the one deliberate confirmation that creates anyway.
test('a match holds the save and the confirmation creates without asking again', async () => {
  let asked = 0;
  const find = async () => {
    asked += 1;
    return [match];
  };
  assert.deepEqual(await duplicateCheck(find, address, null), {
    matches: [match],
  });
  assert.equal(asked, 1);

  // The confirmed attempt answers from what was already named, so the create proceeds in one step.
  assert.deepEqual(await duplicateCheck(find, address, [match]), {
    matches: [match],
  });
  assert.equal(asked, 1);
});

test('an address nobody records adds no step', async () => {
  assert.deepEqual(await duplicateCheck(async () => [], address, null), {
    matches: [],
  });
});

// The warning informs; it never blocks. A check that could not be answered is no warning, so the
// creation goes on exactly as it did before this warning existed.
test('a check that failed is not a warning', async () => {
  const readFailure = async () => {
    throw new RequestError(503, 'unavailable');
  };
  assert.deepEqual(await duplicateCheck(readFailure, address, null), {
    matches: [],
  });
  const lost = async () => {
    throw new Error('network');
  };
  assert.deepEqual(await duplicateCheck(lost, address, null), { matches: [] });
});

test('a session that is gone is reported, not turned into a warning', async () => {
  for (const status of [401, 403]) {
    const denied = async () => {
      throw new RequestError(status, 'access-denied');
    };
    assert.deepEqual(await duplicateCheck(denied, address, null), {
      denied: status,
    });
  }
});
