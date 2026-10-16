// Official unit names are source data: never translated and never rewritten. The dated window
// only comes back for a name that appears twice in one list, so two windows stay distinguishable.
export type UnitOption = {
  name_vi: string;
  valid_from: string;
  valid_to: string | null;
};
export type UnitLevel = 'province' | 'commune';
export function unitCatalogUnavailable(
  level: UnitLevel,
  parent: string | undefined,
  loading: boolean,
  failed: boolean,
) {
  return loading || failed || (level === 'commune' && !parent);
}
export function missingUnitReplacement(
  names: readonly string[],
  valueFor: (name: string) => unknown,
) {
  return ['province_unit_id', 'commune_unit_id'].some(
    (name) => names.includes(name) && !valueFor(name),
  );
}
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
