import { api, RequestError } from '../employees/api.ts';
import type { TodayActivity } from '../employees/activity';
import type { PropertyDetail } from './detail-data';
import type {
  AddressGroup,
  MergeReport,
  OwnerContactDisclosure,
} from './types';

export function loadPropertyDetail(id: string, signal: AbortSignal) {
  return api<PropertyDetail>('/api/properties/' + id, undefined, signal);
}

// The shared-address group of one property: empty for a unique address, so the indicator is
// shown only when another property carries the same recorded address.
export function loadAddressGroup(id: string, signal: AbortSignal) {
  return api<AddressGroup>(
    '/api/properties/' + id + '/duplicates',
    undefined,
    signal,
  );
}

// A deliberate merge of the group into the surviving property, named by the confirmation step.
export function mergeAddressGroup(keepId: string, merge: string[]) {
  return api<MergeReport>('/api/properties/' + keepId + '/duplicates', {
    merge,
  });
}

// A deliberate disclosure: the database commits the access record and returns the phone together.
export function revealOwnerContact(id: string, key: string) {
  return api<OwnerContactDisclosure>(
    '/api/properties/' + id + '/owner-contact',
    { key },
  );
}

export async function loadTodayActivity(
  id: string,
  key: string,
  signal: AbortSignal,
) {
  let viewError = false;
  try {
    await api('/api/properties/' + id + '/page-view', { key }, signal);
  } catch (failure) {
    if (
      signal.aborted ||
      (failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403))
    )
      throw failure;
    viewError = true;
  }
  signal.throwIfAborted();
  let today: TodayActivity | null = null;
  let todayError = false;
  try {
    today = await api<TodayActivity>('/api/activity/today', undefined, signal);
  } catch (failure) {
    if (
      signal.aborted ||
      (failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403))
    )
      throw failure;
    todayError = true;
  }
  signal.throwIfAborted();
  return { viewError, today, todayError };
}
