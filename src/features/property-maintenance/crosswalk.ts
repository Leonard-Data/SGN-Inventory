import type { Locale } from '@/i18n/messages';

// What the official old -> new crosswalk says about the ward of a saved legacy address. Only a
// single whole or rename transfer names the current ward; a partial transfer, more than one row,
// or no row at all says so instead of guessing (D2: a crosswalk is candidate evidence, never a
// write of its own).
export type CrosswalkOutcome =
  | { kind: 'mapped'; commune: string; province: string }
  | { kind: 'several'; count: number }
  | { kind: 'none' };

// The saved address the outcome belongs to, so the one offered action names the row it maps and
// the property context the database checks.
export type AddressCrosswalk = {
  addressId: string;
  propertyRevision: string;
  crosswalk: CrosswalkOutcome;
};

// Exactly one whole or rename row may be offered. Anything else is reported for verification.
export function offeredCrosswalkRow<T extends { relation: string }>(
  rows: readonly T[],
): T | null {
  const row = rows.length === 1 ? rows[0] : undefined;
  return row && (row.relation === 'whole' || row.relation === 'rename')
    ? row
    : null;
}

// The three outcomes read differently on purpose: only the first offers to write anything. The
// wording is this surface's own because each sentence states what the crosswalk does and does not
// establish, and none of them is a generic label.
const copy = {
  mapped: ['Phường/xã cũ đã chuyển thành', 'The old ward became'],
  several: [
    'Cần xác minh phường mới: bảng chuyển đổi ghi nhận',
    'The new ward needs verification: the crosswalk records',
  ],
  wards: ['phường/xã mới.', 'new wards.'],
  none: [
    'Chưa có bảng chuyển đổi cho phường/xã cũ này.',
    'No crosswalk is available for this old ward.',
  ],
} as const;

export function crosswalkMessage(locale: Locale, outcome: CrosswalkOutcome) {
  const at = locale === 'vi' ? 0 : 1;
  return outcome.kind === 'mapped'
    ? `${copy.mapped[at]} ${outcome.commune}, ${outcome.province}.`
    : outcome.kind === 'several'
      ? `${copy.several[at]} ${outcome.count} ${copy.wards[at]}`
      : copy.none[at];
}
