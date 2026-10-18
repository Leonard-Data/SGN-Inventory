import assert from 'node:assert/strict';
import test from 'node:test';
import { creatorName, propertyCreators } from './creator.ts';

test('a resolved creator renders as their display name', () => {
  assert.equal(creatorName('  Nguyễn Thu Hà '), 'Nguyễn Thu Hà');
  const creators = propertyCreators(
    [{ id: 'p1', created_by: 'e1' }],
    [{ id: 'e1', display_name: 'Nguyễn Thu Hà' }],
  );
  assert.equal(creators.get('p1'), 'Nguyễn Thu Hà');
});

// A missing, deleted or unreadable creator shows nothing: no placeholder, no identifier.
test('an unresolvable creator is absent rather than substituted', () => {
  const creators = propertyCreators(
    [
      { id: 'p-null', created_by: null },
      { id: 'p-deleted', created_by: 'e-gone' },
      { id: 'p-blank', created_by: 'e-blank' },
    ],
    [{ id: 'e-blank', display_name: '   ' }],
  );
  assert.equal(creators.size, 0);
  assert.equal(creators.get('p-null'), undefined);
  assert.equal(creators.get('p-deleted'), undefined);
  assert.equal(creatorName(null), null);
  assert.equal(creatorName(undefined), null);
  assert.equal(creatorName(''), null);
});

// The card shows a person, not a sign-in address: an address in this slot renders nothing.
test('an email address is never shown as the creator', () => {
  assert.equal(creatorName('ha.nguyen@saigonnewhouse.vn'), null);
  const creators = propertyCreators(
    [{ id: 'p1', created_by: 'e1' }],
    [{ id: 'e1', display_name: 'ha.nguyen@saigonnewhouse.vn' }],
  );
  assert.equal(creators.get('p1'), undefined);
});
