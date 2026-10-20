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

// The database refusals that mean the committed reservation state moved on while the browser was
// acting: a competing lock was approved or requested first, the property is no longer available
// for the request, or the lock was already closed. Each one means the browser must re-read the
// property's current server state instead of leaving what it held on screen. A refusal is never
// answered from the cached status, because the cached status never authorized the lock: the
// database decides, and this only says that the browser's copy is now stale.
const MOVED_ON = [
  'reservation-conflict',
  'reservation-unavailable',
  'reservation-closed',
];

export function lockStateMoved(code: string): boolean {
  return MOVED_ON.includes(code);
}
