import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTIONS,
  DEFAULT_SECTION,
  NARROW_SECTIONS_QUERY,
  nextSection,
} from './sections.ts';
import { shouldAdoptFactsSnapshot } from './facts-snapshot.ts';

test('the Edit facts dialog keeps the three concerns in order, property facts first', () => {
  assert.deepEqual([...SECTIONS], ['property', 'address', 'contact']);
  assert.equal(DEFAULT_SECTION, 'property');
});

test('the arrow keys move across the sections and wrap at both ends', () => {
  assert.equal(nextSection('property', 'ArrowRight'), 'address');
  assert.equal(nextSection('address', 'ArrowRight'), 'contact');
  assert.equal(nextSection('contact', 'ArrowRight'), 'property');
  assert.equal(nextSection('contact', 'ArrowLeft'), 'address');
  assert.equal(nextSection('property', 'ArrowLeft'), 'contact');
  assert.equal(nextSection('address', 'Home'), 'property');
  assert.equal(nextSection('address', 'End'), 'contact');
});

test('a key the tab pattern does not own leaves the selection alone', () => {
  for (const key of ['Enter', ' ', 'Tab', 'ArrowUp', 'ArrowDown', 'Escape'])
    assert.equal(nextSection('address', key), null, key);
});

test('facts stay on the draft snapshot until its own save refreshes it', () => {
  assert.equal(shouldAdoptFactsSnapshot(null, 'old', 'new'), false);
  assert.equal(shouldAdoptFactsSnapshot('other', 'old', 'new'), false);
  assert.equal(shouldAdoptFactsSnapshot('old', 'old', 'old'), false);
  assert.equal(shouldAdoptFactsSnapshot('old', 'old', 'new'), true);
});

// The dropdown and the tab strip must swap at the same width the shell breaks at,
// otherwise one of the two shapes is reachable when it should not be.
test('the dropdown breakpoint is a breakpoint the stylesheet already uses', () => {
  const width = NARROW_SECTIONS_QUERY.match(/max-width:\s*(\d+)px/)?.[1];
  assert.ok(width, NARROW_SECTIONS_QUERY);
  const css = readFileSync(
    new URL('../../app/sgn-app.css', import.meta.url),
    'utf8',
  );
  assert.match(css, new RegExp(`@media \\(max-width: ${width}px\\)`));
});
