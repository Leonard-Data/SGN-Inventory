import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import { ReportRangeError, reportRange, vietnamToday } from './report-range';

export type ProvinceActivityRow = {
  provinceUnitId: string | null;
  officialCode: string | null;
  provinceName: string | null;
  ownerContactProperties: number;
};

export type ProvinceActivityReport = {
  from: string;
  to: string;
  today: string;
  total: number;
  rows: ProvinceActivityRow[];
};

// The province table behind the manager/admin report (#35). It reuses the report range rules
// and the sibling company report's error mapping, and the database rechecks the live
// manager/admin role on every call, so an ordinary employee only reaches the 403 below.
export async function provinceActivity(
  context: RouteContext,
  params: URLSearchParams,
): Promise<ProvinceActivityReport> {
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
  return {
    ...range,
    today,
    total: rows.reduce((sum, row) => sum + row.ownerContactProperties, 0),
    rows,
  };
}

async function reportRows(
  context: RouteContext,
  from: string,
  to: string,
): Promise<ProvinceActivityRow[]> {
  const { data, error } = await context.client.rpc(
    'company_province_owner_contact_activity',
    { p_from: from, p_to: to },
  );
  if (error) {
    if (error.code === '42501') throw new ApiError(403, 'access-denied');
    // The range is validated above, so these two only surface if the server and the database
    // bounds ever disagree; they stay explicit rather than becoming an empty table.
    if (error.code === '22023') throw new ApiError(400, 'invalid-range');
    throw new ApiError(503, 'unavailable');
  }
  return (data ?? []).map((row) => ({
    provinceUnitId: row.province_unit_id,
    officialCode: row.official_code,
    provinceName: row.province_name,
    ownerContactProperties: Number(row.owner_contact_properties),
  }));
}
