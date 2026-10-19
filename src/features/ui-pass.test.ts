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
