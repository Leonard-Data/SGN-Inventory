import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mayEditProperty, PROPERTY_EDIT_ROLES } from './edit-permission.ts';
import { messages } from '../../i18n/messages.ts';

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

const drawer = source('./property-drawer.tsx');
const detail = source('./detail.tsx');
const workspace = source('../../features/property-maintenance/workspace.tsx');

const staff = { id: 'employee-1', role: 'staff' } as const;
const sales = { id: 'employee-1', role: 'sales' } as const;
const record = { createdBy: 'employee-2', archived: false };

// The rule the database enforces: the property's creator and the staff, manager and admin roles
// may edit it, and an archived record may not be edited by anyone.
test('the property-edit rule admits the creator and the three staff roles', () => {
  assert.deepEqual([...PROPERTY_EDIT_ROLES], ['staff', 'manager', 'admin']);
  for (const role of PROPERTY_EDIT_ROLES)
    assert.equal(mayEditProperty({ id: 'elsewhere', role }, record), true);
  assert.equal(
    mayEditProperty({ id: 'employee-2', role: 'sales' }, record),
    true,
    'the creator may edit their own record',
  );
  assert.equal(mayEditProperty(sales, record), false);
  assert.equal(mayEditProperty(null, record), false);
  assert.equal(
    mayEditProperty(
      { id: 'employee-2', role: 'admin' },
      {
        ...record,
        archived: true,
      },
    ),
    false,
  );
  assert.equal(
    mayEditProperty(staff, { createdBy: null, archived: false }),
    true,
  );
});

// One rule, three surfaces: the full record's editor, the quick view's footer entry and the quick
// view's own price edit all read the same function instead of restating who may edit a property.
test('every surface derives the permission from the one rule', () => {
  for (const [name, file] of [
    ['detail', detail],
    ['maintenance', workspace],
    ['quick view', drawer],
  ] as const) {
    assert.match(file, /mayEditProperty/, `${name} reads the rule`);
    assert.doesNotMatch(
      file,
      /employee\.id === (property|record)?\.?created_by/,
      `${name} does not decide the creator itself`,
    );
  }
});

// The quick view offers a price edit only where the full record would: the gate it renders behind
// is the same rule, decided from the record the server answered with, not from the list's summary.
test('the quick view offers the price edit behind that rule', () => {
  assert.match(
    drawer,
    /const canEdit =\s*record !== null &&\s*mayEditProperty\(employee, \{\s*createdBy: record\.created_by,\s*archived: !!record\.archived_at,/,
  );
  assert.match(
    drawer,
    /\{canEdit \? \(\s*<section\s*className="quick-view-section"\s*aria-labelledby=\{priceId\}\s*data-od-id="quick-view-price"/,
  );
  // The editor is never offered from the summary alone: it needs the record's own revision.
  assert.match(drawer, /\{editingPrice && record \? \(/);
});

// The price edit is the record editor's own form and write path, not a second writer: the same
// field record (`sale_price_vnd`, `monthly_rent_vnd`), the same target, the same route the full
// record posts to, so validation, refusals and the recorded price history are identical.
test('the quick view price edit reuses the record editor path', () => {
  assert.match(
    drawer,
    /const PRICE_FIELDS = \['sale_price_vnd', 'monthly_rent_vnd'\] as const;/,
  );
  assert.match(drawer, /<MutationForm[\s\S]{0,400}target="property"/);
  assert.match(
    drawer,
    /<RecordFields locale=\{locale\} values=\{record\} names=\{PRICE_FIELDS\} \/>/,
  );
  const saver = drawer.slice(drawer.indexOf('function PriceEditor('));
  assert.match(
    saver,
    /`\/api\/properties\/\$\{propertyId\}\/maintenance`/,
    'the same route the full record editor posts to',
  );
  assert.match(
    saver,
    /target: 'property',\s*targetId: propertyId,\s*revision: record\.revision,\s*propertyRevision: record\.revision,/,
  );
  assert.match(
    workspace,
    /'\/api\/properties\/' \+ facts\.id \+ '\/maintenance'/,
  );
});

// A committed price is reported the way every committed change is: the server's own summary goes
// to the browser's catalogue, so the list row behind the panel takes the new price with no reload.
test('a saved price reaches the list through the existing reconciliation', () => {
  assert.match(
    drawer,
    /import \{ useCatalogueChange \} from '\.\/catalogue-provider'/,
  );
  assert.match(
    drawer,
    /import \{ applyServerSummary \} from '\.\/catalogue-changes'/,
  );
  assert.match(drawer, /applyServerSummary\(applyChange, result, propertyId\)/);
});

// A property in negotiation with no numeric price reads the same on both surfaces: the fact is
// stated with the missing-value marker, and the edit is offered from it rather than hidden.
test('a missing price reads the same on the quick view and the full record', () => {
  const missing =
    /className=\{\s*[a-z_.]+ === null \? 'is-unknown' : 'num'\s*\}/;
  assert.match(drawer, missing);
  assert.match(
    detail,
    /property\.sale_price_vnd === null\s*\? 'is-unknown'\s*: 'num'/,
  );
  assert.match(drawer, /=== null\s*\?\s*text\.unknown/);
  assert.match(detail, /property\.sale_price_vnd === null\s*\? text\.unknown/);
  // The price rows are always rendered, so a record with no price still has one to edit.
  assert.doesNotMatch(drawer, /property\.salePriceVnd !== null \?/);
});

test('the price edit carries both languages', () => {
  for (const locale of ['vi', 'en'] as const)
    assert.ok(messages[locale].editPrice.trim().length, `${locale}.editPrice`);
  assert.notEqual(messages.vi.editPrice, messages.en.editPrice);
});
