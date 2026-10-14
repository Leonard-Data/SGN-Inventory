import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import { ReportRangeError, reportRange, vietnamToday } from './report-range';

export type MyActivityRow = {
  businessDay: string;
  pageViewEvents: number;
  distinctPropertiesViewed: number;
  ownerContactProperties: number;
};

export type MyActivityReport = {
  from: string;
  to: string;
  today: string;
  todayTotals: {
    pageViewEvents: number;
    distinctPropertiesViewed: number;
    ownerContactProperties: number;
  };
  rows: MyActivityRow[];
};

// The employee's own read behind the personal activity report. The database takes no employee
// parameter, so no input can widen the scope to a colleague's events, whatever the caller's role.
export async function myActivity(
  context: RouteContext,
  params: URLSearchParams,
): Promise<MyActivityReport> {
  const today = vietnamToday();
  let range;
  try {
    range = reportRange(
      { from: params.get('from'), to: params.get('to') },
      today,
    );
  } catch (failure) {
    throw new ApiError(
      400,
      failure instanceof ReportRangeError ? failure.code : 'invalid-input',
    );
  }
  const rows = await reportRows(context, range.from, range.to);
  const todayRows =
    range.from <= today && today <= range.to
      ? rows.filter((row) => row.businessDay === today)
      : await reportRows(context, today, today);
  return {
    ...range,
    today,
    todayTotals: {
      pageViewEvents: sum(todayRows, 'pageViewEvents'),
      distinctPropertiesViewed: sum(todayRows, 'distinctPropertiesViewed'),
      ownerContactProperties: sum(todayRows, 'ownerContactProperties'),
    },
    rows,
  };
}

function sum(rows: MyActivityRow[], key: keyof MyActivityRow): number {
  return rows.reduce((total, row) => total + Number(row[key]), 0);
}

async function reportRows(
  context: RouteContext,
  from: string,
  to: string,
): Promise<MyActivityRow[]> {
  const { data, error } = await context.client.rpc('my_daily_activity', {
    p_from: from,
    p_to: to,
  });
  if (error) {
    if (error.code === '42501') throw new ApiError(403, 'access-denied');
    // The application validates the range first, so this is only reached if the database
    // bound ever disagrees with it; it is still an input problem, never a zero report.
    if (error.code === '22023') throw new ApiError(400, 'invalid-range');
    throw new ApiError(503, 'unavailable');
  }
  return (data ?? []).map((row) => ({
    businessDay: row.business_day,
    pageViewEvents: Number(row.page_view_events),
    distinctPropertiesViewed: Number(row.distinct_properties_viewed),
    ownerContactProperties: Number(row.owner_contact_properties),
  }));
}
