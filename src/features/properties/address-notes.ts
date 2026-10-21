import type { CrosswalkOutcome } from '@/features/property-maintenance/crosswalk';
import { unitHierarchy } from './format.ts';

// The parts of a recorded address the record page states beside it.
export type RecordedAddress = {
  format: string;
  province_unit_id: string | null;
  district_unit_id: string | null;
  commune_unit_id: string | null;
};

// What the record page states beside one recorded address: the official hierarchy a legacy address
// was entered in, largest tier first, and what the official crosswalk says about its ward. Neither
// replaces the recorded text, which is shown exactly as it was entered.
//
// Only a legacy address carries a district, so only a legacy address states a hierarchy or asks the
// crosswalk: a current address's geography is the two tiers it recorded, and stating it here would
// present the current tier as the hierarchy the record was written in.
export function addressNotes<T extends RecordedAddress>(
  address: T,
  unitNames: ReadonlyMap<string, string>,
  crosswalks: ReadonlyMap<string, CrosswalkOutcome | null>,
): T & { hierarchy: string; crosswalk: CrosswalkOutcome | null } {
  if (address.format !== 'legacy')
    return { ...address, hierarchy: '', crosswalk: null };
  return {
    ...address,
    hierarchy: unitHierarchy(
      [
        address.province_unit_id,
        address.district_unit_id,
        address.commune_unit_id,
      ].map((id) => (id ? unitNames.get(id) : null)),
    ),
    crosswalk: address.commune_unit_id
      ? (crosswalks.get(address.commune_unit_id) ?? null)
      : null,
  };
}
