import assert from 'node:assert/strict';
import test from 'node:test';
import { creatorName, propertyCreators, propertyModifiers } from './creator.ts';

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

// The modifier is resolved from the summary the list already holds, so the quick view states who
// last edited the record without a read of its own, and an unresolvable modifier stays absent.
test('the last modifier resolves to their display name, never to a placeholder', () => {
  const modifiers = propertyModifiers(
    [
      { id: 'p1', updated_by: 'e1' },
      { id: 'p-none', updated_by: null },
      { id: 'p-gone', updated_by: 'e-gone' },
      { id: 'p-address', updated_by: 'e2' },
    ],
    [
      { id: 'e1', display_name: ' Trần Văn Minh ' },
      { id: 'e2', display_name: 'minh.tran@saigonnewhouse.vn' },
    ],
  );
  assert.equal(modifiers.get('p1'), 'Trần Văn Minh');
  assert.equal(modifiers.get('p-none'), undefined);
  assert.equal(modifiers.get('p-gone'), undefined);
  assert.equal(modifiers.get('p-address'), undefined);
});
