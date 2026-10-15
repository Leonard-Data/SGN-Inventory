import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, DEFAULT_SECTION, nextSection } from './sections.ts';

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
