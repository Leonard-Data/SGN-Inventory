// The two-tier catalog is in force from this date; earlier rows belong to the closed pre-2025
// three-tier generation and are never offered as a current province or commune.
export const CURRENT_CATALOG_START = '2025-07-01';

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
