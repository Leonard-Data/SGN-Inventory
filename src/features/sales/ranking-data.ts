import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import type { Employee } from '@/features/employees/types';
import {
  ReportRangeError,
  reportRange,
  vietnamToday,
} from '@/features/employees/report-range';
import type { CompletedSaleRankRow, CompletedSaleRanking } from './types';

function rows(value: unknown): CompletedSaleRankRow[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: CompletedSaleRankRow[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const entry = row as Record<string, unknown>;
    if (
      typeof entry.employeeId !== 'string' ||
      typeof entry.employeeName !== 'string' ||
      !Number.isInteger(entry.completedSales) ||
      !Number.isInteger(entry.rank) ||
      (entry.completedSales as number) < 0 ||
      (entry.rank as number) < 1
    )
      return null;
    parsed.push({
      employeeId: entry.employeeId,
      employeeName: entry.employeeName,
      completedSales: entry.completedSales as number,
      rank: entry.rank as number,
    });
  }
  return parsed;
}

// Manager/admin-only read over the recorded completions. The period defaults to today and the
// preceding 29 Vietnam calendar days, and the aggregation happens in the database so no
// stored total can drift from the underlying workflow.
export async function completedSaleRanking(
  context: RouteContext,
  employee: Employee,
  params: URLSearchParams,
): Promise<CompletedSaleRanking> {
  if (employee.role !== 'manager' && employee.role !== 'admin')
    throw new ApiError(403, 'access-denied');
  if ([...params.keys()].some((key) => key !== 'from' && key !== 'to'))
    throw new ApiError(400, 'invalid-input');
  const today = vietnamToday();
  let range;
  try {
    range = reportRange(
      { from: params.get('from'), to: params.get('to') },
      today,
    );
  } catch (error) {
    if (error instanceof ReportRangeError) throw new ApiError(400, error.code);
    throw error;
  }
  const { data, error } = await context.client.rpc('completed_sale_ranking', {
    p_from: range.from,
    p_to: range.to,
  });
  if (error) {
    if (error.code === '42501') throw new ApiError(403, 'access-denied');
    if (error.code === '22023') throw new ApiError(400, 'invalid-range');
    throw new ApiError(503, 'unavailable');
  }
  const report =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  const ranking = report ? rows(report.rows) : null;
  if (
    !ranking ||
    !report ||
    !Number.isInteger(report.totalCompletedSales) ||
    !Number.isInteger(report.unknownAttribution)
  )
    throw new ApiError(503, 'unavailable');
  return {
    from: range.from,
    to: range.to,
    today,
    rows: ranking,
    totalCompletedSales: report.totalCompletedSales as number,
    unknownAttribution: report.unknownAttribution as number,
  };
}
