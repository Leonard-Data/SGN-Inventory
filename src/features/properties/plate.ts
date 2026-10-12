/* ════════════════════════════════════════════════════════════════════════════
   Site plate — pure geometry from record fields. No React, no DOM.
   One scale for every record so the results grid reads as a plan atlas.
   Nothing is invented: frontage × depth = plot, floor ÷ storeys = footprint,
   direction = north arrow. A record with no areas returns drawable: false.
   ════════════════════════════════════════════════════════════════════════════ */

export const PPM = 5.4;
export const PPM_HERO = 8.4;

export type Variant = 'card' | 'bare' | 'hero';

export interface RecordFields {
  frontage_m?: number | null;
  depth_m?: number | null;
  land_area_m2?: number | null;
  floor_area_m2?: number | null;
  floors?: number | null;
  direction?: string | null;
  access_type?: string | null;
}

export interface SheetLayout {
  w: number;
  h: number;
  plan: { x: number; y: number; w: number; h: number };
  col: { x: number; w: number } | null;
  strip: number | null;
  ppm: number;
}

export const SHEETS: Record<Variant, SheetLayout> = {
  card: {
    w: 320,
    h: 200,
    plan: { x: 16, y: 16, w: 184, h: 130 },
    col: { x: 208, w: 96 },
    strip: 176,
    ppm: PPM,
  },
  bare: {
    w: 320,
    h: 200,
    plan: { x: 64, y: 20, w: 192, h: 160 },
    col: null,
    strip: null,
    ppm: PPM,
  },
  hero: {
    w: 640,
    h: 300,
    plan: { x: 36, y: 30, w: 356, h: 202 },
    col: { x: 428, w: 176 },
    strip: 266,
    ppm: PPM_HERO,
  },
};

export interface PlotRect {
  w: number;
  d: number;
}

export interface BuiltRect {
  w: number;
  d: number;
  area: number;
}

export interface PlateGeometry {
  plot: PlotRect | null;
  built: BuiltRect | null;
  unit: boolean;
  derivedAspect: boolean;
  land: number;
  builtArea: number;
  open: number;
  density: number;
  storeys: number;
  frontage: number;
  depth: number;
  drawable: boolean;
}

const DIR_ANGLE: Record<string, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

function pos(v: number | null | undefined): number {
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : 0;
}

export function fmt(v: number): string {
  const r = Math.round(v * 10) / 10;
  return r % 1 === 0 ? String(r) : r.toFixed(1).replace('.', ',');
}

export function directionAngle(dir: string | null | undefined): number {
  return dir && DIR_ANGLE[dir] != null ? DIR_ANGLE[dir] : 0;
}

export function computeGeometry(p: RecordFields): PlateGeometry {
  const land = pos(p.land_area_m2);
  const floorArea = pos(p.floor_area_m2);
  const storeys = Math.max(1, pos(p.floors) || 1);
  const frontage = pos(p.frontage_m);
  const depth = pos(p.depth_m);
  let plot: PlotRect | null = null;
  let derivedAspect = false;

  if (land > 0) {
    if (frontage > 0 && depth > 0) {
      plot = { w: frontage, d: depth };
    } else {
      const side = Math.sqrt(land);
      plot = { w: side, d: side };
      derivedAspect = true;
    }
  }

  const builtArea = floorArea > 0 ? floorArea / storeys : 0;
  let built: BuiltRect | null = null;
  let unit = false;

  if (builtArea > 0) {
    if (plot) {
      const bw = Math.min(
        frontage > 0 ? frontage : plot.w,
        Math.sqrt(builtArea),
      );
      const bd = Math.min(plot.d, builtArea / bw);
      built = { w: bw, d: bd, area: bw * bd };
    } else {
      const s = Math.sqrt(builtArea);
      built = { w: s, d: s, area: builtArea };
      unit = true;
    }
  }

  const open = plot ? Math.max(0, land - (built ? built.area : 0)) : 0;

  return {
    plot,
    built,
    unit,
    derivedAspect,
    land: plot ? land : builtArea,
    builtArea,
    open,
    density: plot && built && land ? built.area / land : 0,
    storeys,
    frontage,
    depth,
    drawable: !!(plot || built),
  };
}

/** Scale the target rect (plot or built) to pixel coords within a sheet. */
export function layoutTarget(
  sheet: SheetLayout,
  g: PlateGeometry,
): { px: number; py: number; pw: number; pd: number; baseY: number } | null {
  if (!g.drawable) return null;
  const target = g.plot || g.built!;
  const pw = target.w * sheet.ppm;
  const pd = target.d * sheet.ppm;
  let baseY = sheet.plan.y + sheet.plan.h;
  if (sheet === SHEETS.bare) baseY = Math.round((sheet.h + pd) / 2);
  const px = sheet.plan.x + (sheet.plan.w - pw) / 2;
  const py = baseY - pd;
  return { px, py, pw, pd, baseY };
}
