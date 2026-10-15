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
  // The daily table's own state: its report refuses an employee × day scope above the Data API
  // row cap, and that refusal is reported for the daily section alone. The ranking is an
  // aggregate read and is returned either way, so the daily payload limit never decides whether
  // a manager can see the ranking.
  rowsError: 'range-too-large' | null;
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
  // The ranking is its own aggregate read over the committed daily units, so it is read first
  // and independently of the companion daily table: the daily row cap never decides whether the
  // ranking is available, and a 30-day first open still returns real totals and ranks.
  const ranking = await rankingRows(context, range.from, range.to);
  const daily = await dailyRows(context, range.from, range.to);
  const todayRows =
    daily.error === null && range.from <= today && today <= range.to
      ? daily.rows.filter((row) => row.businessDay === today)
      : await reportRows(context, today, today);
  return {
    ...range,
    today,
    todayTotals: {
      pageViewEvents: sum(todayRows, 'pageViewEvents'),
      distinctPropertiesViewed: sum(todayRows, 'distinctPropertiesViewed'),
      ownerContactProperties: sum(todayRows, 'ownerContactProperties'),
    },
    rows: daily.rows,
    rowsError: daily.error,
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

// The daily section's own read. Its row cap is reported as this section's state rather than as
// the whole report's failure, so an over-cap daily scope no longer hides the ranking; every
// other failure still fails the request.
async function dailyRows(
  context: RouteContext,
  from: string,
  to: string,
): Promise<{ rows: CompanyActivityRow[]; error: 'range-too-large' | null }> {
  try {
    return { rows: await reportRows(context, from, to), error: null };
  } catch (failure) {
    if (failure instanceof ApiError && failure.code === 'range-too-large')
      return { rows: [], error: 'range-too-large' };
    throw failure;
  }
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
