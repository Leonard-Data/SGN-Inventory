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
export function clearedUnits(): AddressUnits {
  return { province: '', district: '', commune: '' };
}

// Picking a level clears the levels beneath it once the value actually changes: a ward or district
// from the previous parent would name a unit that no longer hangs off the chosen one, while
// re-picking the value already held leaves the recorded units where they are.
export function pickedProvince(
  prior: AddressUnits,
  province: string,
): AddressUnits {
  return prior.province === province
    ? prior
    : { province, district: '', commune: '' };
}
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

// What a district pick or a province change writes into the source district text: the next name
// while the field holds nothing or the official name of the district the address records, so a
// re-pick rewrites a picker-written label and a province change clears it, while a person's own
// wording stays untouched. No answer leaves the field as it is.
export function filledDistrictText(
  current: string | null | undefined,
  recordedName: string | null | undefined,
  next: string,
): string | null {
  const value = String(current ?? '').trim();
  if (value === next) return null;
  return value === '' || (recordedName != null && value === recordedName.trim())
    ? next
    : null;
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
>(listed: readonly T[], day: string | null, recorded?: string | null): T[] {
  return listed.filter(
    (unit) => unit.id === recorded || unitOfferedOn(unit, day),
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
