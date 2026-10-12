// Company report period selection. Vietnam calendar dates are plain YYYY-MM-DD strings, so a
// browser timezone never changes the period and no Date object crosses the wire.
export type ReportRange = { from: string; to: string };

export class ReportRangeError extends Error {
  constructor(public readonly code: 'invalid-input' | 'invalid-range') {
    super(code);
  }
}

const dayMs = 86400000;
const maxSpanDays = 365;

function shiftDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!) + days * dayMs)
    .toISOString()
    .slice(0, 10);
}

export function isReportDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && shiftDays(value, 0) === value;
}

export function vietnamToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((value) => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// Today and the preceding 29 Vietnam calendar days, inclusive.
export function defaultRange(today: string): ReportRange {
  return { from: shiftDays(today, -29), to: today };
}

export function reportRange(
  requested: { from: string | null; to: string | null },
  today: string,
): ReportRange {
  if (requested.from === null && requested.to === null)
    return defaultRange(today);
  if (
    requested.from === null ||
    requested.to === null ||
    !isReportDate(requested.from) ||
    !isReportDate(requested.to)
  )
    throw new ReportRangeError('invalid-input');
  const span =
    (Date.parse(`${requested.to}T00:00:00Z`) -
      Date.parse(`${requested.from}T00:00:00Z`)) /
    dayMs;
  if (span < 0 || span > maxSpanDays)
    throw new ReportRangeError('invalid-range');
  return { from: requested.from, to: requested.to };
}
