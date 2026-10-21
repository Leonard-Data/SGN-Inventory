import type { Locale } from '@/i18n/messages';

// What the official old -> new crosswalk says about the ward of a saved legacy address. Only a
// single whole or rename transfer names the current ward; a partial transfer, more than one row,
// or no row at all says so instead of guessing (D2: a crosswalk is candidate evidence, never a
// write of its own). A ward whose current address is already recorded says that instead, so the
// one action is never presented after it has been used.
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

// The three outcomes read differently on purpose: only the first offers to write anything. The
// wording is this surface's own because each sentence states what the crosswalk does and does not
// establish, and none of them is a generic label.
const copy = {
  mapped: ['Phường/xã cũ đã chuyển thành', 'The old ward became'],
  several: [
    'Cần xác minh phường mới: bảng chuyển đổi ghi nhận',
    'The new ward needs verification: the crosswalk records',
  ],
  ward: ['phường/xã mới.', 'new ward.'],
  wards: ['phường/xã mới.', 'new wards.'],
  none: [
    'Chưa có bảng chuyển đổi cho phường/xã cũ này.',
    'No crosswalk is available for this old ward.',
  ],
  recorded: [
    'Địa chỉ mới cho phường/xã cũ này đã được ghi trước đó.',
    'The current address for this old ward is already recorded.',
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

// Whether the current address the crosswalk names is already recorded for this legacy address: a
// current row linked by supersedes_address_id to the legacy row or to any row of its own chain, so
// a repeat after a correction of that row is recognised as recorded rather than offered again.
export function crosswalkRecorded<
  T extends {
    id: string;
    format: string;
    supersedes_address_id: string | null;
  },
>(rows: readonly T[], legacyId: string): boolean {
  const chain = new Set([legacyId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) {
      if (row.format !== 'legacy' || !row.supersedes_address_id) continue;
      if (chain.has(row.id) === chain.has(row.supersedes_address_id)) continue;
      chain.add(row.id).add(row.supersedes_address_id);
      grew = true;
    }
  }
  return rows.some(
    (row) =>
      row.format === 'current' &&
      row.supersedes_address_id !== null &&
      chain.has(row.supersedes_address_id),
  );
}
