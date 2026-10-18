// A stand-in for content that is still arriving. The shapes below only decide how much
// grey space to reserve, so a surface can hold the layout the real rows are about to take.

// Announced once, politely, by the region that carries the shapes. The shapes themselves
// are aria-hidden, so a screen reader hears one "loading" state and no placeholder noise.
export const SKELETON_REGION = {
  role: 'status',
  'aria-live': 'polite',
  'aria-busy': true,
} as const;

// A read that lands inside this window paints no skeleton at all, so fast data never
// flashes a grey frame. Long enough to cover a local read, short enough to pre-empt a wait.
export const SKELETON_FLASH_GUARD_MS = 160;

export type SkeletonShape = 'lines' | 'rows' | 'table';

export type SkeletonBox = { w: string; h: number };

// Boxes stand in for the line boxes the real rows occupy, not for the glyphs: a reserved
// block the height of a 14px line is a text line's worth of space, so the surrounding
// layout lands exactly where it would with the content in place.
const textLine = 21;
const metaLine = 16;
const tableLine = 16;

// Widths and heights of the stand-in lines per row: enough variation to read as text, no
// claim about the content. `lines` is a short paragraph, `rows` a list of records, `table`
// a grid of cells.
export function skeletonRows(
  shape: SkeletonShape,
  rows: number,
  columns: number,
): SkeletonBox[][] {
  const count = Math.max(1, rows);
  if (shape === 'table') {
    const cols = Math.max(1, columns);
    return Array.from({ length: count }, () =>
      Array.from({ length: cols }, () => ({ w: '88%', h: tableLine })),
    );
  }
  if (shape === 'rows') {
    return Array.from({ length: count }, () => [
      { w: '62%', h: textLine },
      { w: '44%', h: metaLine },
      { w: '30%', h: 12 },
    ]);
  }
  return Array.from({ length: count }, (_, row) => [
    { w: row === count - 1 ? '54%' : '96%', h: metaLine },
  ]);
}
