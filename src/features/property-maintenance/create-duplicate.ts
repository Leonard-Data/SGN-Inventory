import { RequestError } from '../employees/api.ts';
import type { AddressMatch } from '@/features/properties/types';
import type { Changes } from './fields';

// The pre-create address check. The database decides the match; this says only when to ask and
// what an answer means. A match holds the save so the person can look, and the confirmation that
// contains the warning is not asked again, so creating anyway stays one step. A read that failed is
// not a warning, because a duplicate was never allowed to block a creation; a session that is gone
// is not a warning problem at all.
export type DuplicateCheck = { matches: AddressMatch[] } | { denied: number };

export async function duplicateCheck(
  find: (address: Changes) => Promise<AddressMatch[]>,
  address: Changes,
  confirmed: AddressMatch[] | null,
): Promise<DuplicateCheck> {
  if (confirmed) return { matches: confirmed };
  try {
    return { matches: await find(address) };
  } catch (failure) {
    if (
      failure instanceof RequestError &&
      (failure.status === 401 || failure.status === 403)
    )
      return { denied: failure.status };
    return { matches: [] };
  }
}
