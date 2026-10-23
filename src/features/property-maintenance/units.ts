// The business records addresses in one province, so the app states it instead of asking: every
// picker, dependent list and submitted address names this one official unit, and no surface offers a
// province choice. One official unit has a row per catalog generation, so a read of the levels
// beneath it resolves `id` to that unit's row for the generation it is reading, and an address
// records the row of its own generation. Its name is source data, so it is never translated.
export const FIXED_PROVINCE = {
  id: 'cc2ace6d-f3e8-424c-9105-a560983abae0',
  name: 'Thành phố Hồ Chí Minh',
} as const;

// The province an address form submits: the stated province, or the one the record already stores,
// which keeps its recorded value instead of being overwritten by an edit.
export function statedProvince(recorded: unknown): string {
  const held = typeof recorded === 'string' ? recorded.trim() : '';
  return held || FIXED_PROVINCE.id;
}

// Which of one official unit's rows a read is about: the row whose window covers the stated day, or
// for no stated day the current generation's. That is how a read of the levels beneath a province or
// district names one unit across the two catalog generations rather than the version row a caller
// happened to hold.
export function generationRow<
  T extends { valid_from: string; valid_to: string | null },
>(rows: readonly T[], day: string | null): T | undefined {
  return rows.find((row) => unitOfferedOn(row, day));
}

// The two-tier catalog is in force from this date; earlier rows belong to the closed pre-2025
// three-tier generation and are never offered as a current province or commune.
export const CURRENT_CATALOG_START = '2025-07-01';

// The pre-2025 three-tier generation covers the closed [2025-01-04, 2025-07-01) window, so a legacy
// picker reads the day that window opened and lists the old districts and wards.
export const LEGACY_CATALOG_DAY = '2025-01-04';

// The identifiers one address carries. A legacy address names all three levels; a current address
// names the province and commune and has no district.
export type AddressUnits = {
  province: string;
  district: string;
  commune: string;
};
// An address form's cleared levels. The province stays the app's stated one: only the levels the
// pickers had chosen beneath it are cleared, by a format switch or by picking another parent.
export function clearedUnits(): AddressUnits {
  return { province: FIXED_PROVINCE.id, district: '', commune: '' };
}

// The province row an address records once a level beneath it is picked: that level's own parent,
// which is the stated province's row for this address's catalog generation. The database guard
// requires a district, and a commune, to be parented by the province and district the address
// records, so the recorded row has to be the one the picked unit actually hangs off. No pick leaves
// the province exactly as it stands.
export function pickedProvinceRow(
  province: string,
  picked: { parent_id?: string | null } | undefined,
): string {
  return picked?.parent_id ?? province;
}

// Picking a level clears the levels beneath it once the value actually changes: a ward from the
// previous district would name a unit that no longer hangs off the chosen one, while re-picking the
// value already held leaves the recorded units where they are.
export function pickedDistrict(
  prior: AddressUnits,
  district: string,
): AddressUnits {
  return prior.district === district
    ? prior
    : { ...prior, district, commune: '' };
}

// Which unit a picker narrows by. A legacy ward hangs off its district and never off the province,
// so a ward list opens only once a district is chosen; a current commune hangs off the province.
// A level with no parent yet lists nothing.
export function unitParent(
  generation: 'legacy' | 'current',
  level: 'province' | 'district' | 'commune',
  units: AddressUnits,
): string | undefined {
  if (level === 'province') return undefined;
  if (level === 'district') return units.province || undefined;
  return (
    (generation === 'legacy' ? units.district : units.province) || undefined
  );
}

// What a district pick or a province change writes into the source district text: the picker is the
// only writer of that field, so everything but the picked name itself is replaced — a re-pick
// repairs an imported shorthand — and a province change clears it. No answer leaves it as it is.
export function filledDistrictText(
  current: string | null | undefined,
  next: string,
): string | null {
  return String(current ?? '').trim() === next ? null : next;
}

// The one rule every catalog read applies: a stated Vietnam calendar day offers the units whose
// half-open window covers it, while no stated day offers every current-generation row, a 2026
// rename window that has since closed included, so a unit id recorded then still answers with its
// official name.
export function unitOfferedOn(
  unit: { valid_from: string; valid_to: string | null },
  day: string | null,
): boolean {
  return day === null
    ? unit.valid_from >= CURRENT_CATALOG_START
    : unit.valid_from <= day && (unit.valid_to === null || unit.valid_to > day);
}

// What a picker offers: the units whose window covers the stated day, plus the recorded unit's own
// row whatever generation it belongs to, so an address recorded before this entry still reads and
// submits the unit it holds.
export function offeredUnits<
  T extends { id: string; valid_from: string; valid_to: string | null },
>(
  listed: readonly T[],
  day: string | null,
  recorded: readonly string[] = [],
): T[] {
  return listed.filter(
    (unit) => recorded.includes(unit.id) || unitOfferedOn(unit, day),
  );
}

// Official unit names are source data: never translated and never rewritten. The dated window
// only comes back for a name that appears twice in one list, so two windows stay distinguishable.
export type UnitOption = {
  name_vi: string;
  valid_from: string;
  valid_to: string | null;
};
export function unitOptionLabels(units: readonly UnitOption[]): string[] {
  const seen = new Map<string, number>();
  for (const unit of units)
    seen.set(unit.name_vi, (seen.get(unit.name_vi) ?? 0) + 1);
  return units.map((unit) =>
    (seen.get(unit.name_vi) ?? 0) > 1
      ? `${unit.name_vi} (${unit.valid_from} – ${unit.valid_to ?? ''})`
      : unit.name_vi,
  );
}
