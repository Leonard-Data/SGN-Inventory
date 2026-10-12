// Application-boundary bounds; the database check constraints and guarded RPCs stay the
// authority, so these mirror them rather than replacing them.
export const RESERVATION_REASON_MIN = 10;
export const RESERVATION_REASON_MAX = 2000;
export const RESERVATION_DAYS_MIN = 1;
export const RESERVATION_DAYS_MAX = 30;
export const RESERVATION_DAYS_DEFAULT = 7;

// Source text is preserved verbatim apart from trimming, in either interface language.
export function reservationReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  const length = [...reason].length;
  return length >= RESERVATION_REASON_MIN && length <= RESERVATION_REASON_MAX
    ? reason
    : null;
}

export function decisionDays(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= RESERVATION_DAYS_MIN &&
    value <= RESERVATION_DAYS_MAX
    ? value
    : null;
}
