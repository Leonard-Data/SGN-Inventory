import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

test('the sidebar expanded state follows the active desktop or mobile layout', () => {
  const shell = source('./navigation/app-shell.tsx');
  assert.match(
    shell,
    /const sidebarExpanded = desktop \? !sidebarCollapsed : drawer/,
  );
  assert.match(shell, /aria-expanded=\{sidebarExpanded\}/);
  assert.match(shell, /inert=\{!sidebarExpanded\}/);
});

test('contact editing uses the same drawer with contact copy and a required save acknowledgement', () => {
  const directory = source('./contacts/directory-view.tsx');
  assert.doesNotMatch(directory, /className="row-detail"|copy\.optional/);
  assert.match(directory, /<ContactEditorDrawer/);
  const editor = source('./contacts/editor-drawer.tsx');
  assert.match(editor, /<EditDrawer/);
  assert.match(editor, /type="checkbox" required/);
  assert.match(editor, /saveContext=/);
  assert.match(editor, /revision: editor\.impact\.revision/);
  assert.match(editor, /contactOptional/);
});

test('employee edits use the shared guarded drawer and retain field validation', () => {
  const directory = source('./employees/employee-directory.tsx');
  const panel = source('./employees/employee-profile-panel.tsx');
  assert.doesNotMatch(directory, /\{profileOpen \? \(/);
  assert.match(panel, /<EditDrawer/);
  assert.match(panel, /profileProblems\(/);
  assert.match(panel, /elements\.namedItem\(\s*found\[0\]/);
  assert.match(panel, /disabled=\{busy\}/);
});

test('the inventory summary scrolls inside its surface and measures that scrollport', () => {
  const css = source('../app/sgn-surfaces.css');
  const inventory = source('./properties/inventory.tsx');
  assert.match(
    css,
    /\.inventory-stream\[data-view='table'\] \{[^}]*overflow: auto/,
  );
  assert.match(css, /\.inventory-table thead th \{[^}]*top: 0/);
  assert.match(inventory, /node\.scrollTop/);
  assert.match(inventory, /node\.addEventListener\('scroll'/);
  assert.doesNotMatch(
    inventory,
    /className="btn btn-secondary btn-sm toolbar-dir"/,
  );
  assert.equal((inventory.match(/text\.searchHint/g) ?? []).length, 0);
});

test('app.css alone owns design tokens and base typography', () => {
  const tokens = source('../app/app.css');
  const vocabulary = source('../app/sgn-app.css');
  assert.match(tokens, /:root \{/);
  assert.doesNotMatch(
    vocabulary,
    /:root \{|^body \{|^h1, h2, \.type-display \{/m,
  );
});

test('content has explicit wide and form variants with compact app controls', () => {
  const css = source('../app/sgn-app.css');
  const shell = source('./navigation/app-shell.tsx');
  assert.match(shell, /data-layout=/);
  assert.match(
    css,
    /\.sgn-content\[data-layout="wide"\] \{[^}]*max-width: none/,
  );
  assert.match(css, /\.sgn-content\[data-layout="form"\]/);
  assert.match(css, /--control-h: 44px/);
});

test('shared tables distinguish column headings from semantic row headers', () => {
  const css = source('../app/sgn-app.css');
  assert.doesNotMatch(css, /\.data-table th \{/);
  assert.match(css, /\.data-table thead th \{/);
  assert.match(
    css,
    /\.data-table tbody th\[scope="row"\] \{[^}]*text-transform: none/,
  );
  assert.match(css, /\.data-table\.stackable tbody th\[scope="row"\]/);
  for (const path of [
    'employees/employee-directory.tsx',
    'contacts/directory-view.tsx',
    'vendors/directory-view.tsx',
    'employees/company-report.tsx',
  ]) {
    assert.match(source('./' + path), /scope="row"/, path);
  }
});

test('the employee directory renders one page header in every state', () => {
  const directory = source('./employees/employee-directory.tsx');
  // The page rendered two page-head blocks carrying the same heading, so the title and its
  // toolbar appeared twice. One header carries the eyebrow, the heading the panel is labelled by,
  // the note and the toolbar, and it is the only one.
  assert.equal((directory.match(/className="page-head"/g) ?? []).length, 1);
  assert.equal((directory.match(/<h1/g) ?? []).length, 1);
  const head = directory.slice(
    directory.indexOf('className="page-head"'),
    directory.indexOf('hidden={!actor || busy}'),
  );
  assert.match(head, /<p className="example">\{text\.people\}<\/p>/);
  assert.match(head, /<h1 id="employees">\{text\.employeeDirectory\}<\/h1>/);
  assert.match(
    head,
    /<p className="intro-copy">\{text\.employeeDirectoryNote\}<\/p>/,
  );
  assert.match(head, /mayAdministerEmployees\(actor\?\.role \?\? ''\)/);
  assert.match(directory, /aria-labelledby="employees"/);
  // The header holds its place from the first paint: it is drawn before the surface and the
  // loading state, which belongs inside the content area rather than above the page.
  const surfaceAt = directory.indexOf('hidden={!actor || busy}');
  assert.ok(directory.indexOf('className="page-head"') < surfaceAt);
  assert.ok(
    directory.indexOf('{busy ? (') > surfaceAt,
    'the loading skeleton sits below the surface, inside the content area',
  );
});

test('every table draws the same rounded surface and the document reserves its scrollbar', () => {
  const css = source('../app/sgn-app.css');
  const base = source('../app/app.css');
  // The frame belongs to the table itself, so a table written later cannot miss out on it.
  const start = css.indexOf(
    '.data-table {\n  width: 100%; border-collapse: separate',
  );
  assert.ok(start > 0, 'the shared table surface is declared on .data-table');
  const rule = css.slice(start, css.indexOf('}', start));
  assert.match(rule, /border: 1px solid var\(--border\)/);
  assert.match(rule, /border-radius: var\(--radius-lg\)/);
  assert.match(rule, /border-collapse: separate/);
  // The corners of the first and last rows follow the frame; the last row is the last row of
  // the last group that holds rows, because a streamed table ends in a reserved gap.
  for (const corner of [
    '.data-table thead th:first-child {',
    '.data-table thead th:last-child {',
    '.data-table > tbody:not(:has(~ tbody > tr)) > tr:last-child > :first-child {',
    '.data-table > tbody:not(:has(~ tbody > tr)) > tr:last-child > :last-child {',
  ])
    assert.ok(css.includes(corner), `${corner} rounds a corner with the frame`);
  // The directories scroll with the document, which reserves the room its scrollbar takes; the
  // inventory stream already reserves the same gutter on its own bounded scrollport.
  assert.match(base, /html:has\(\.sgn-app\) \{ scrollbar-gutter: stable; \}/);
  // A streamed table sizes its columns from the header, so mounting a window cannot re-cut them.
  assert.match(
    css,
    /\.employee-table-wrap \.data-table \{ table-layout: fixed; \}/,
  );
  const directory = source('./employees/employee-directory.tsx');
  for (const column of ['name', 'email', 'role', 'bio', 'access', 'actions'])
    assert.match(
      directory,
      new RegExp(`data-column="${column}"`),
      `${column} names its column`,
    );
});

test('the stacked mobile table keeps the access cell inside its row', () => {
  const css = source('../app/sgn-app.css');
  // The desktop column keeps the width that holds its badges; the one-column stack releases it,
  // because a minimum width inside a stack wider than the phone makes the page scroll sideways.
  assert.match(css, /\.data-table \.status-cell \{ min-width: 210px; \}/);
  const stacked = css.slice(
    css.indexOf('.data-table.stackable thead'),
    css.indexOf('.data-table.stackable .row-detail td::before'),
  );
  assert.match(
    stacked,
    /\.data-table\.stackable \.status-cell \{ min-width: 0; flex-wrap: wrap; \}/,
  );
  // The value wraps between its badges, never inside one.
  assert.match(css, /\.badge \{[^}]*white-space: nowrap/);
});
