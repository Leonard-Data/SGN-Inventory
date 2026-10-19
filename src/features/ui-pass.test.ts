import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

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
