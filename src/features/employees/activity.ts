import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';

export type TodayActivity = {
  businessDay: string;
  pageViewEvents: number;
  distinctPropertiesViewed: number;
};

// Own Page views for the database's Asia/Ho_Chi_Minh day; reviewers read no colleagues here.
export async function todayActivity(
  context: RouteContext,
): Promise<TodayActivity> {
  const { data, error } = await context.client.rpc('my_today_activity');
  if (error)
    throw new ApiError(
      error.code === '42501' ? 403 : 503,
      error.code === '42501' ? 'access-denied' : 'unavailable',
    );
  const row = data?.[0];
  if (!row) throw new ApiError(503, 'unavailable');
  return {
    businessDay: row.business_day,
    pageViewEvents: row.page_view_events,
    distinctPropertiesViewed: row.distinct_properties_viewed,
  };
}
