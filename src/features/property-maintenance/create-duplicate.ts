import { RequestError } from '../employees/api.ts';
import type { AddressMatch } from '@/features/properties/types';
import type { Changes } from './fields';

// The pre-create address check. The database decides the match; this says only when to ask and
// what an answer means. A match holds the save so the person can look, and the submit that
// follows is the confirmation: it asks nothing again and creates in that one step. A read that
// failed is not a warning, because a duplicate was never allowed to block a creation; a session
// that is gone is not a warning problem at all.
export type CreateOutcome<T> =
  { matches: AddressMatch[] } | { denied: number } | { created: T };

export async function createAfterWarning<T>(
  find: (address: Changes) => Promise<AddressMatch[]>,
  address: Changes,
  confirmed: AddressMatch[] | null,
  create: () => Promise<T>,
): Promise<CreateOutcome<T>> {
  if (!confirmed) {
    let matches: AddressMatch[] = [];
    try {
      matches = await find(address);
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403)
      )
        return { denied: failure.status };
    }
    if (matches.length) return { matches };
  }
  return { created: await create() };
}
