import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { SKELETON_FLASH_GUARD_MS, SKELETON_REGION } from './skeleton-shape.ts';

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

const appCss = source('../app/app.css');
const appLayer = source('../app/sgn-app.css');

// Every surface that used to show a spinner or a loading line while its data arrived. The
// list is the contract: a surface that loads data shows a skeleton of its own shape, and a
// new loading surface is added here with the skeleton it renders.
const SKELETON_SURFACES = [
  'properties/inventory.tsx',
  'properties/detail.tsx',
  'properties/reservation.tsx',
  'contacts/directory-view.tsx',
  'corrections/queue.tsx',
  'corrections/amendments.tsx',
  'employees/company-report.tsx',
  'employees/my-report.tsx',
  'employees/province-report.tsx',
  'employees/employee-directory.tsx',
  'employees/employee-deactivation.tsx',
  'employees/employee-account-deletion.tsx',
  'employees/employee-invitation.tsx',
  'property-comments/discussion.tsx',
  'property-files/workspace.tsx',
  'property-files/cover-image.tsx',
  'property-maintenance/history.tsx',
  'property-maintenance/price-history.tsx',
  'property-maintenance/workspace.tsx',
  'sales/ranking.tsx',
  'sales/completion.tsx',
  'vendors/detail-view.tsx',
  'vendors/directory-view.tsx',
  'vendors/property-vendors.tsx',
];

test('every loading surface reserves its shape with the shared skeleton', () => {
  for (const surface of SKELETON_SURFACES) {
    const file = source('./' + surface);
    const renders =
      file.includes('<LoadingSkeleton') ||
      file.includes('<SkeletonCards') ||
      file.includes('<Skeleton');
    assert.ok(renders, `${surface} renders no skeleton`);
    assert.ok(
      !/className="(busy-line|busy-bar|busy-head|spinner)"/.test(file),
      `${surface} still renders a spinner or a loading line`,
    );
    assert.ok(
      !/\{text\.loading\}\s*<\/p>/.test(file),
      `${surface} still renders a bare loading line`,
    );
  }
});

// One polite announcement per region, and no placeholder noise: the shapes are decorative,
// the label inside the region is what assistive technology reads.
test('the skeleton region announces once and hides its shapes', () => {
  assert.equal(SKELETON_REGION.role, 'status');
  assert.equal(SKELETON_REGION['aria-live'], 'polite');
  assert.equal(SKELETON_REGION['aria-busy'], true);
  const primitive = source('./skeleton.tsx');
  assert.match(primitive, /span className="sr"/);
  assert.match(primitive, /skeleton-shape sk-' \+ shape\} aria-hidden="true"/);
  // The blocks themselves never reach a screen reader.
  assert.match(primitive, /aria-hidden="true"\n\s*\/>/);
  // Content that arrives inside the guard paints no skeleton at all.
  assert.ok(SKELETON_FLASH_GUARD_MS > 0);
  assert.match(primitive, /setTimeout\(\(\) => setShown\(true\),/);
});

// The shimmer is an animation like every other, so the global reduced-motion rule stops it
// instead of leaving a surface that keeps moving for a user who asked it not to.
test('the skeleton stops animating under prefers-reduced-motion', () => {
  const block = appCss.slice(
    appCss.indexOf('@media (prefers-reduced-motion: reduce)'),
  );
  assert.ok(block, 'app.css has no reduced-motion block');
  const rules = block.slice(0, block.indexOf('}', block.indexOf('{')) + 1);
  assert.match(rules, /\*, \*::before, \*::after/);
  assert.match(rules, /animation-duration: \.01ms !important/);
  assert.match(rules, /animation-iteration-count: 1 !important/);
  assert.match(appLayer, /\.skeleton::after \{[^}]*animation: sgn-shimmer/);
});

// Headings and body share one sans family; codes, figures and prices keep the mono face.
test('the type scale resolves to a single sans family', () => {
  for (const css of [appCss]) {
    assert.ok(!css.includes('--font-display'), 'the display token survives');
    assert.ok(
      !css.includes('--sgn-font-display'),
      'a display face still loads',
    );
    const heading = css.slice(css.indexOf('h1, h2, .type-display {'));
    const rule = heading.slice(0, heading.indexOf('}'));
    assert.match(rule, /font-family: var\(--font-body\)/);
    assert.match(rule, /font-weight: 600/);
  }
  assert.match(appCss, /--font-body: var\(--sgn-font-body\)/);
  assert.match(appCss, /--font-mono: var\(--sgn-font-mono\)/);
  // Body copy is 400: the base rule sets no weight of its own.
  const body = appCss.slice(appCss.indexOf('body {'));
  assert.ok(!body.slice(0, body.indexOf('}')).includes('font-weight'));
  assert.match(appLayer, /\.card-price \{ font-family: var\(--font-mono\)/);
  assert.match(appCss, /\.num, \.type-mono \{ font-family: var\(--font-mono\)/);
});

// The app ships no display face and fetches no font from the network at build or run time.
test('no display font is loaded or referenced', () => {
  const fonts = source('../app/fonts.ts');
  assert.ok(!/Oswald|oswald|--sgn-font-display/.test(fonts));
  assert.ok(
    !/from 'next\/font\/google'/.test(fonts),
    'a remote font loader survives',
  );
  assert.ok(
    !existsSync(new URL('../app/fonts/oswald-latin.woff2', import.meta.url)),
  );
});
