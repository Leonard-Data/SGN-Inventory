import { isReportDate } from '../employees/report-range.ts';

// Application-boundary bounds; the database check constraint and the guarded RPC stay the
// authority, so these mirror them rather than replacing them.
export const SALE_REFERENCE_MAX = 200;

// An actual Vietnam completion date as a plain YYYY-MM-DD calendar date. The database
// rejects a future date; this rejects a malformed one before any request is sent.
export function completionDate(value: unknown): string | null {
  return typeof value === 'string' && isReportDate(value) ? value : null;
}

// Source text is preserved verbatim apart from trimming, in either interface language.
export function completionReference(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const reference = value.trim();
  const length = [...reference].length;
  return length >= 1 && length <= SALE_REFERENCE_MAX ? reference : null;
}
