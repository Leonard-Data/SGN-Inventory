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

// The ranking rows are the ranked range total per employee in the authorized company-report
// scope; the database derives them from the committed daily units, so a contributor deactivated
// after recording activity stays attributed with its retained total. Page views and distinct
// properties viewed stay in the daily report and never enter the rank.
export type CompanyRankingRow = {
  employeeId: string;
  employeeName: string;
  employeeActive: boolean;
  rank: number;
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
  ranking: CompanyRankingRow[];
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
  const [rows, ranking] = await Promise.all([
    reportRows(context, range.from, range.to),
    rankingRows(context, range.from, range.to),
  ]);
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
    ranking,
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
  if (error) {
    if (error.code === '42501') throw new ApiError(403, 'access-denied');
    if (error.code === '54000') throw new ApiError(400, 'range-too-large');
    throw new ApiError(503, 'unavailable');
  }
  return (data ?? []).map((row) => ({
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    businessDay: row.business_day,
    pageViewEvents: Number(row.page_view_events),
    distinctPropertiesViewed: Number(row.distinct_properties_viewed),
    ownerContactProperties: Number(row.owner_contact_properties),
  }));
}

// The employee ranking read behind the same report: the database derives every total from the
// committed daily units and rechecks the live manager/admin role, so an ordinary employee only
// ever reaches the same 403 mapping.
async function rankingRows(
  context: RouteContext,
  from: string,
  to: string,
): Promise<CompanyRankingRow[]> {
  const { data, error } = await context.client.rpc(
    'employee_owner_contact_ranking',
    { p_from: from, p_to: to },
  );
  if (error) {
    if (error.code === '42501') throw new ApiError(403, 'access-denied');
    if (error.code === '54000') throw new ApiError(400, 'range-too-large');
    throw new ApiError(503, 'unavailable');
  }
  return (data ?? []).map((row) => ({
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    employeeActive: row.employee_active,
    rank: Number(row.rank_position),
    ownerContactProperties: Number(row.owner_contact_properties),
  }));
}
