// The eligible oldest-first/newest-first inventory read pages on a date-plus-identity key.
// A token is the cursor the browser carries between pages; the database derives every row and
// every age, so this module only encodes, validates and decodes those keys. Unknown entry dates
// are their own cursor section rather than a missing row, so the token says which section it is.
export type InventoryOrder = 'oldest' | 'newest';
export type AgeCursor =
  { date: string; id: string } | { unknown: true; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isInventoryOrder(value: unknown): value is InventoryOrder {
  return value === 'oldest' || value === 'newest';
}

export function encodeAgeCursor(row: {
  entryOn: string | null;
  id: string;
}): string {
  return row.entryOn ? `d:${row.entryOn}:${row.id}` : `u:${row.id}`;
}

export type AgeCursorResult =
  { ok: true; cursor: AgeCursor | null } | { ok: false };

// An absent cursor is the first page, not an error; a malformed one must be rejected so a
// mistyped or tampered cursor never silently restarts the walk.
export function decodeAgeCursor(
  token: string | null | undefined,
): AgeCursorResult {
  if (token === null || token === undefined || token === '')
    return { ok: true, cursor: null };
  const parts = token.split(':');
  if (
    parts.length === 3 &&
    parts[0] === 'd' &&
    DATE.test(parts[1]!) &&
    isRealDate(parts[1]!) &&
    UUID.test(parts[2]!)
  )
    return { ok: true, cursor: { date: parts[1]!, id: parts[2]! } };
  if (parts.length === 2 && parts[0] === 'u' && UUID.test(parts[1]!))
    return { ok: true, cursor: { unknown: true, id: parts[1]! } };
  return { ok: false };
}

export function ageCursorArgs(cursor: AgeCursor | null): {
  p_after_on?: string;
  p_after_id?: string;
  p_after_unknown?: boolean;
} {
  if (!cursor) return {};
  return 'date' in cursor
    ? { p_after_on: cursor.date, p_after_id: cursor.id }
    : { p_after_unknown: true, p_after_id: cursor.id };
}

// The pagination trail mixes the first-page marker with opaque cursor tokens; a token from the
// other ordering must not be replayed as this one, so validation follows the active mode.
export function validTrailToken(
  order: InventoryOrder | null,
  token: string,
): boolean {
  if (token === '~') return true;
  return order ? decodeAgeCursor(token).ok : UUID.test(token);
}

function isRealDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
