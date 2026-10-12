import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import { ReportRangeError, reportRange, vietnamToday } from './report-range';

export type CompanyActivityRow = {
  employeeId: string;
  employeeName: string;
  businessDay: string;
  pageViewEvents: number;
  distinctPropertiesViewed: number;
  ownerContactProperties: number;
};

export type CompanyActivityReport = {
  from: string;
  to: string;
  today: string;
  todayTotals: {
    pageViewEvents: number;
    distinctPropertiesViewed: number;
    ownerContactProperties: number;
  };
  rows: CompanyActivityRow[];
};

// The company-wide read behind the manager/admin report; the database enforces the live
// manager/admin role, so an ordinary employee only ever reaches the 403 mapping below.
export async function companyActivity(
  context: RouteContext,
  params: URLSearchParams,
): Promise<CompanyActivityReport> {
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

function sum(
  rows: CompanyActivityRow[],
  key: keyof CompanyActivityRow,
): number {
  return rows.reduce((total, row) => total + Number(row[key]), 0);
}

async function reportRows(
  context: RouteContext,
  from: string,
  to: string,
): Promise<CompanyActivityRow[]> {
  const { data, error } = await context.client.rpc(
    'company_employee_daily_activity',
    { p_from: from, p_to: to },
  );
  if (error)
    throw new ApiError(
      error.code === '42501' ? 403 : 503,
      error.code === '42501' ? 'access-denied' : 'unavailable',
    );
  return (data ?? []).map((row) => ({
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    businessDay: row.business_day,
    pageViewEvents: Number(row.page_view_events),
    distinctPropertiesViewed: Number(row.distinct_properties_viewed),
    ownerContactProperties: Number(row.owner_contact_properties),
  }));
}
