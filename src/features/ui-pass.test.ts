import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

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
