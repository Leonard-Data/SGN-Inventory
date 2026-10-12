import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeGeometry,
  layoutTarget,
  fmt,
  directionAngle,
  SHEETS,
  PPM,
  PPM_HERO,
} from './plate.ts';

test('one scale shared by all records — card and bare use PPM, hero uses PPM_HERO', () => {
  assert.equal(PPM, 5.4);
  assert.equal(PPM_HERO, 8.4);
  assert.equal(SHEETS.card.ppm, PPM);
  assert.equal(SHEETS.bare.ppm, PPM);
  assert.equal(SHEETS.hero.ppm, PPM_HERO);
});

test('3× area ⇒ 3× drawn area at same scale', () => {
  const g1 = computeGeometry({
    land_area_m2: 100,
    frontage_m: 10,
    depth_m: 10,
  });
  const g2 = computeGeometry({
    land_area_m2: 300,
    frontage_m: 10,
    depth_m: 30,
  });
  assert(g1.plot && g2.plot);
  const lay1 = layoutTarget(SHEETS.card, g1)!;
  const lay2 = layoutTarget(SHEETS.card, g2)!;
  // Same frontage: widths equal.
  assert.equal(lay1.pw, lay2.pw);
  // Depth 3× ⇒ drawn depth 3×.
  assert.equal(lay2.pd / lay1.pd, 3);
});

test('missing areas ⇒ drawable false and placeholder', () => {
  const g = computeGeometry({});
  assert.equal(g.drawable, false);
  assert.equal(g.plot, null);
  assert.equal(g.built, null);
  assert.equal(g.land, 0);
  assert.equal(g.builtArea, 0);
  assert.equal(g.open, 0);
});

test('direction ⇒ expected rotation', () => {
  assert.equal(directionAngle('N'), 0);
  assert.equal(directionAngle('NE'), 45);
  assert.equal(directionAngle('E'), 90);
  assert.equal(directionAngle('SE'), 135);
  assert.equal(directionAngle('S'), 180);
  assert.equal(directionAngle('SW'), 225);
  assert.equal(directionAngle('W'), 270);
  assert.equal(directionAngle('NW'), 315);
  assert.equal(directionAngle(null), 0);
  assert.equal(directionAngle(undefined), 0);
  assert.equal(directionAngle(''), 0);
});

test('footprint/open-ground arithmetic matches floor_area_m2 ÷ floors and land − footprint', () => {
  const g = computeGeometry({
    land_area_m2: 200,
    floor_area_m2: 300,
    floors: 3,
    frontage_m: 10,
    depth_m: 20,
  });
  assert(g.plot && g.built);
  // Plot = 10 × 20 = 200 m².
  assert.equal(g.plot.w, 10);
  assert.equal(g.plot.d, 20);
  // Footprint = 300 ÷ 3 = 100 m².
  assert.equal(g.built.area, 100);
  // Open ground = 200 − 100 = 100 m².
  assert.equal(g.open, 100);
  // Coverage = 100 / 200 = 0.5.
  assert.equal(g.density, 0.5);
});

test('only floor area, no plot — unit mode, square footprint', () => {
  const g = computeGeometry({
    floor_area_m2: 200,
    floors: 2,
  });
  assert.equal(g.plot, null);
  assert(g.built);
  assert.equal(g.unit, true);
  // Footprint = 200 ÷ 2 = 100, sqrt = 10.
  assert.equal(g.built.w, 10);
  assert.equal(g.built.d, 10);
  assert.equal(g.built.area, 100);
  // drawable via built.
  assert.equal(g.drawable, true);
});

test('frontage-only without depth — derived aspect ratio from land area', () => {
  const g = computeGeometry({
    land_area_m2: 100,
    frontage_m: 10,
  });
  assert(g.plot);
  assert.equal(g.derivedAspect, true);
  // Derived: sqrt(100) = 10, but frontage_m forces w=10 so d=10.
  assert.equal(g.plot.w, 10);
  assert.equal(g.plot.d, 10);
});

test('bare layout centers vertically', () => {
  const g = computeGeometry({
    land_area_m2: 80,
    frontage_m: 8,
    depth_m: 10,
  });
  const lay = layoutTarget(SHEETS.bare, g)!;
  // baseY centered: (sheet.h + pd) / 2.
  const pd = 10 * PPM;
  assert.equal(lay.baseY, Math.round((200 + pd) / 2));
});

test('fmt uses comma for VI decimal', () => {
  assert.equal(fmt(10), '10');
  assert.equal(fmt(10.5), '10,5');
  assert.equal(fmt(3.14), '3,1');
});
