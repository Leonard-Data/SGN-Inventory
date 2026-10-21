import type { Locale } from '@/i18n/messages';

// What the official old -> new crosswalk says about the ward of a saved legacy address. Only a
// single whole or rename transfer names the current ward; a partial transfer, more than one row,
// or no row at all says so instead of guessing (D2: a crosswalk is candidate evidence, never a
// write of its own). The ward whose current address is already recorded says that instead, so the
// one action is never presented after it has been used - and only that ward, because a correction
// can change the ward the saved row records (issue #236).
export type CrosswalkOutcome =
  | { kind: 'mapped'; commune: string; province: string }
  | { kind: 'several'; count: number }
  | { kind: 'none' }
  | { kind: 'recorded' };

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

// The four outcomes read differently on purpose: only the first offers to write anything. The
// wording is this surface's own because each sentence states what the crosswalk does and does not
// establish, and none of them is a generic label.
const copy = {
  mapped: [
    'Phường/xã cũ đang lưu đã chuyển thành',
    'The old ward saved here became',
  ],
  several: [
    'Cần xác minh phường mới: bảng chuyển đổi ghi nhận',
    'The new ward needs verification: the crosswalk records',
  ],
  ward: ['phường/xã mới.', 'new ward.'],
  wards: ['phường/xã mới.', 'new wards.'],
  none: [
    'Chưa có bảng chuyển đổi cho phường/xã cũ đang lưu.',
    'No crosswalk is available for the old ward saved here.',
  ],
  recorded: [
    'Địa chỉ mới cho phường/xã cũ đang lưu đã được ghi trước đó.',
    'The current address for the old ward saved here is already recorded.',
  ],
} as const;

export function crosswalkMessage(locale: Locale, outcome: CrosswalkOutcome) {
  const at = locale === 'vi' ? 0 : 1;
  return outcome.kind === 'mapped'
    ? `${copy.mapped[at]} ${outcome.commune}, ${outcome.province}.`
    : outcome.kind === 'several'
      ? `${copy.several[at]} ${outcome.count} ${(outcome.count === 1 ? copy.ward : copy.wards)[at]}`
      : outcome.kind === 'recorded'
        ? copy.recorded[at]
        : copy.none[at];
}

// The format a deliberate conversion writes for an address row. Only the two geographies a
// crosswalk relates are convertible: an 'alternate' row is a source record, so it offers nothing.
export function conversionTarget(format: string): 'legacy' | 'current' | null {
  return format === 'legacy'
    ? 'current'
    : format === 'current'
      ? 'legacy'
      : null;
}

// Whether the property already records a current address for the territory the crosswalk names.
// One current address per commune is the rule the recording guard and the format conversion both
// hold, so this is their comparison: the unit's official code inside the current generation,
// whichever validity window each row's own version belongs to, and whichever way the row arrived -
// a conversion writes the legacy row, and a correction of that row moves the supersedes chain on
// without the current row it came from ever naming the successor.
export function crosswalkRecorded(
  rows: readonly {
    format: string;
    commune_unit_id: string | null;
  }[],
  targetCode: string | undefined,
  codes: ReadonlyMap<string, string>,
): boolean {
  return (
    targetCode !== undefined &&
    rows.some(
      (row) =>
        row.format === 'current' &&
        row.commune_unit_id !== null &&
        codes.get(row.commune_unit_id) === targetCode,
    )
  );
}
