import assert from 'node:assert/strict';
import test from 'node:test';
import { dimensions } from './dimension-summary.ts';

const member = (
  frontageM: string | null,
  depthM: string | null,
  landAreaM2: string | null,
) => ({ frontageM, depthM, landAreaM2 });

test('a recorded frontage and depth render together with the land area', () => {
  assert.equal(
    dimensions(member('6', '20', '120.5'), 'en'),
    '6 × 20 m · 120.5 m²',
  );
  assert.equal(
    dimensions(member('6', '20', '120.5'), 'vi'),
    '6 × 20 m · 120,5 m²',
  );
  assert.equal(dimensions(member('6', '20', null), 'en'), '6 × 20 m');
});

test('a recorded frontage or depth is not dropped when its pair is missing', () => {
  assert.equal(
    dimensions(member('5', null, '100'), 'en'),
    'Frontage 5 m · 100 m²',
  );
  assert.equal(dimensions(member('5', null, null), 'en'), 'Frontage 5 m');
  assert.equal(
    dimensions(member(null, '18', '100'), 'vi'),
    'Chiều sâu 18 m · 100 m²',
  );
  assert.equal(dimensions(member(null, '18', null), 'vi'), 'Chiều sâu 18 m');
});

test('a land area alone still renders', () => {
  assert.equal(dimensions(member(null, null, '100'), 'en'), '100 m²');
});

test('a record with no recorded dimensions renders nothing', () => {
  assert.equal(dimensions(member(null, null, null), 'en'), null);
});
