import { api, RequestError } from '../employees/api.ts';
import type { TodayActivity } from '../employees/activity';
import type { PropertyDetail } from './detail-data';

export function loadPropertyDetail(id: string, signal: AbortSignal) {
  return api<PropertyDetail>('/api/properties/' + id, undefined, signal);
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
