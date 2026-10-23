import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closedCombobox,
  comboboxKey,
  filterUnitOptions,
  foldUnitName,
  openCombobox,
  streetComboboxKey,
  streetSuggestions,
  typeInCombobox,
  type ComboboxOption,
} from './combobox.ts';
import { formChanges, recordsAddressPart } from './fields.ts';
import { STREET_NAMES } from './streets.ts';

const units: ComboboxOption[] = [
  { value: '', label: 'Any' },
  { value: 'hcm', label: 'Thành phố Hồ Chí Minh' },
  { value: 'dong-nai', label: 'Tỉnh Đồng Nai' },
  { value: 'binh-minh', label: 'Xã Bình Minh' },
  { value: 'ben-thanh', label: 'Phường Bến Thành' },
];

const labels = (query: string | null) =>
  filterUnitOptions(units, query).map((option) => option.label);

test('typing without diacritics reaches an official Vietnamese unit name', () => {
  assert.deepEqual(labels('dong nai'), ['Tỉnh Đồng Nai']);
  assert.deepEqual(labels('ĐỒNG'), ['Tỉnh Đồng Nai']);
  assert.deepEqual(labels('ho chi minh'), ['Thành phố Hồ Chí Minh']);
  assert.deepEqual(labels('phuong'), ['Phường Bến Thành']);
  assert.equal(foldUnitName('Tỉnh Đồng Nai'), 'tinh dong nai');
});

test('the list is unfiltered until something is typed', () => {
  assert.deepEqual(
    labels(null),
    units.map((unit) => unit.label),
  );
  assert.deepEqual(
    labels(''),
    units.map((unit) => unit.label),
  );
  assert.deepEqual(
    labels('   '),
    units.map((unit) => unit.label),
  );
});

test('filtering keeps the source name and reports no match instead of accepting one', () => {
  const [match] = filterUnitOptions(units, 'binh');
  assert.equal(match?.label, 'Xã Bình Minh');
  assert.equal(match?.value, 'binh-minh');
  assert.deepEqual(filterUnitOptions(units, 'zzz'), []);
});

test('reopening shows the whole list with the committed unit highlighted', () => {
  const selected = units.findIndex((unit) => unit.value === 'dong-nai');
  const state = openCombobox(selected);
  assert.deepEqual(state, { open: true, query: null, active: 2 });
  // The field still carries the committed label, and the arrow keys move from the selection.
  assert.equal(
    filterUnitOptions(units, state.query)[state.active]?.value,
    'dong-nai',
  );
  assert.equal(comboboxKey(state, 'ArrowDown', units.length).state.active, 3);
  assert.equal(comboboxKey(state, 'ArrowUp', units.length).state.active, 1);
});

test('typing highlights the first match and highlights nothing when nothing matches', () => {
  const typed = typeInCombobox('phuong', labels('phuong').length);
  assert.deepEqual(typed, { open: true, query: 'phuong', active: 0 });
  const none = typeInCombobox('zzz', 0);
  assert.equal(none.active, -1);
  assert.equal(none.open, true);
});

test('the arrows move through the filtered list and wrap at both ends', () => {
  const state = openCombobox(-1);
  assert.equal(comboboxKey(state, 'ArrowDown', 3).state.active, 0);
  assert.equal(comboboxKey(state, 'ArrowUp', 3).state.active, 2);
  assert.equal(
    comboboxKey({ ...state, active: 2 }, 'ArrowDown', 3).state.active,
    0,
  );
  assert.equal(
    comboboxKey({ ...state, active: 0 }, 'ArrowUp', 3).state.active,
    2,
  );
  assert.equal(comboboxKey(state, 'End', 3).state.active, 2);
  assert.equal(comboboxKey({ ...state, active: 2 }, 'Home', 3).state.active, 0);
  assert.equal(comboboxKey(state, 'ArrowDown', 0).state.active, -1);
});

test('Enter commits the highlighted unit of the filtered list and closes', () => {
  const filtered = filterUnitOptions(units, 'binh');
  const state = { open: true, query: 'binh' as string | null, active: 0 };
  const result = comboboxKey(state, 'Enter', filtered.length);
  assert.equal(result.commit, 0);
  assert.deepEqual(result.state, closedCombobox);
  assert.equal(filtered[result.commit!]?.value, 'binh-minh');
});

test('the all-units entry commits the empty value that means no condition', () => {
  const any = filterUnitOptions(units, 'any');
  assert.deepEqual(any, [{ value: '', label: 'Any' }]);
  const result = comboboxKey(
    typeInCombobox('any', any.length),
    'Enter',
    any.length,
  );
  assert.equal(any[result.commit!]?.value, '');
  assert.deepEqual(result.state, closedCombobox);
});

test('Enter with nothing highlighted commits nothing and keeps the message on screen', () => {
  const state = typeInCombobox('zzz', 0);
  const result = comboboxKey(state, 'Enter', 0);
  assert.equal(result.commit, null);
  assert.equal(result.handled, true);
  assert.equal(result.state.open, true);
  assert.equal(result.state.query, 'zzz');
});

test('Escape closes without a commit and Enter closed is the form’s own submit', () => {
  const open = { open: true, query: 'binh' as string | null, active: 0 };
  const escaped = comboboxKey(open, 'Escape', 1);
  assert.equal(escaped.commit, null);
  assert.deepEqual(escaped.state, closedCombobox);
  assert.deepEqual(comboboxKey(closedCombobox, 'Enter', 0), {
    state: closedCombobox,
    commit: null,
    handled: false,
  });
});

test('keys that are not the picker’s own are left to the field', () => {
  for (const key of ['a', 'Backspace', 'Tab', 'PageDown'])
    assert.equal(comboboxKey(openCombobox(0), key, 2).handled, false, key);
});

// The street field is a suggestion layer: the committed list only decides what is offered, never what
// a street may be.
test('a listed street is offered as a suggestion, also when typed without diacritics', () => {
  assert.ok(
    streetSuggestions(STREET_NAMES, 'ly thuong').includes('Lý Thường Kiệt'),
  );
  assert.ok(
    streetSuggestions(STREET_NAMES, 'LÝ THƯỜNG').includes('Lý Thường Kiệt'),
  );
});

test('a street typed by hand that the list does not carry still saves as typed', () => {
  const typed = 'Hẻm 42 Đường Chưa Có Tên';
  // Nothing is offered for it, and that is not a refusal: the field submits the text as it stands.
  assert.deepEqual(streetSuggestions(STREET_NAMES, typed), []);
  const form = new FormData();
  form.set('street', typed);
  assert.deepEqual(formChanges('address', form), { street: typed });
  assert.equal(recordsAddressPart({ street: typed, format: 'legacy' }), true);
});

// The street field keeps the unit picker's keyboard contract, except that Enter is the form's own
// submit when no suggestion is highlighted, so typing an unlisted street still saves in one press.
test('Enter submits a typed street nothing highlights, and picks a highlighted one', () => {
  const typed = 'Hẻm 42 Đường Chưa Có Tên';
  const none = typeInCombobox(
    typed,
    streetSuggestions(STREET_NAMES, typed).length,
  );
  assert.deepEqual(streetComboboxKey(none, 'Enter', 0), {
    state: none,
    commit: null,
    handled: false,
  });
});

test('Enter picks the highlighted street and closes the list', () => {
  const matches = streetSuggestions(STREET_NAMES, 'ly thuong');
  const state = typeInCombobox('ly thuong', matches.length);
  const result = streetComboboxKey(state, 'Enter', matches.length);
  assert.equal(result.handled, true);
  assert.deepEqual(result.state, closedCombobox);
  assert.equal(matches[result.commit!], 'Lý Thường Kiệt');
});

test('the arrows and the ends move the highlight the field applies', () => {
  const typed = typeInCombobox('', 3);
  assert.equal(streetComboboxKey(typed, 'ArrowDown', 3).state.active, 1);
  assert.equal(streetComboboxKey(typed, 'ArrowUp', 3).state.active, 2);
  assert.equal(streetComboboxKey(typed, 'End', 3).state.active, 2);
  assert.equal(streetComboboxKey(typed, 'Home', 3).state.active, 0);
  // Focused with nothing highlighted, the first arrow lands on the first suggestion.
  assert.equal(
    streetComboboxKey(openCombobox(-1), 'ArrowDown', 3).state.active,
    0,
  );
  const moved = streetComboboxKey(typed, 'ArrowDown', 3);
  assert.equal(moved.handled, true);
  assert.equal(moved.commit, null);
  assert.equal(moved.state.open, true);
});

test('Escape closes the street list and leaves the typed street to the field', () => {
  const typed = 'Hẻm 42 Đường Chưa Có Tên';
  const escaped = streetComboboxKey(typeInCombobox(typed, 0), 'Escape', 0);
  assert.equal(escaped.handled, true);
  assert.deepEqual(escaped.state, closedCombobox);
  // Closed, the field shows the value onChange kept, not the query the list was filtered by.
  assert.equal(escaped.state.query, null);
});
