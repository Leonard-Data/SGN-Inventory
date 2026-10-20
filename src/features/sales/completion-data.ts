import 'server-only';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import type { Employee } from '@/features/employees/types';
import { accessState } from '@/features/employees/directory';
import { vietnamToday } from '@/features/employees/report-range';
import { catalogueSummaryOf } from '@/features/properties/catalogue-data';
import { completionDate, completionReference } from './rules';
import type {
  CompletedSale,
  SaleCompletionBlock,
  SaleCompletionResult,
  SaleCompletionState,
} from './types';

const claim = 'property_id,requested_by,employee_name';
const completionColumns =
  'id,property_id,credited_employee_id,completed_on,reference,previous_status,version,confirmed_by,confirmed_at';

function reviewer(employee: Employee): void {
  if (employee.role !== 'manager' && employee.role !== 'admin')
    throw new ApiError(403, 'access-denied');
}

function databaseError(error: { code?: string }): ApiError {
  return error.code === '42501'
    ? new ApiError(403, 'access-denied')
    : new ApiError(503, 'unavailable');
}

// The guarded workflow reports its refusals with dedicated SQLSTATE codes so the browser
// can name the exact cause instead of a generic failure.
function workflowError(error: { code?: string }): ApiError {
  if (error.code === '42501') return new ApiError(403, 'access-denied');
  if (error.code === '22023') return new ApiError(400, 'invalid-input');
  if (error.code === 'P0007') return new ApiError(400, 'future-date');
  if (error.code === 'P0004') return new ApiError(409, 'self-credit-forbidden');
  if (error.code === 'P0006') return new ApiError(409, 'completion-conflict');
  if (error.code === 'P0003') return new ApiError(409, 'reservation-conflict');
  if (error.code === 'P0002') return new ApiError(409, 'rental-active');
  if (error.code === 'P0005') return new ApiError(409, 'sale-unavailable');
  return new ApiError(503, 'unavailable');
}

// Reviewer-scoped completion context: the recorded completion if one stands, the effective
// reservation claimant as a suggestion that still needs explicit confirmation, the employee
// identities the confirmation may credit, and why the form is unavailable otherwise.
export async function saleCompletionState(
  context: RouteContext,
  employee: Employee,
  id: string,
): Promise<SaleCompletionState> {
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  reviewer(employee);
  const [
    propertyResult,
    employeesResult,
    completionResult,
    rentalResult,
    claimResult,
  ] = await Promise.all([
    context.client
      .from('properties')
      .select('id,status,archived_at')
      .eq('id', id)
      .maybeSingle(),
    context.client.rpc('list_employee_credit_options'),
    context.client
      .from('sale_completions')
      .select(completionColumns)
      .eq('property_id', id)
      .is('reversed_at', null)
      .maybeSingle(),
    context.client
      .from('rental_agreements')
      .select('id')
      .eq('property_id', id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle(),
    context.client
      .from('v_effective_property_locks')
      .select(claim)
      .eq('property_id', id)
      .maybeSingle(),
  ]);
  if (
    propertyResult.error ||
    employeesResult.error ||
    completionResult.error ||
    rentalResult.error ||
    claimResult.error
  )
    throw databaseError(
      propertyResult.error ??
        employeesResult.error ??
        completionResult.error ??
        rentalResult.error ??
        claimResult.error!,
    );
  const property = propertyResult.data;
  if (!property) throw new ApiError(404, 'not-found');
  const names = new Map(
    (employeesResult.data ?? []).map((row) => [row.id, row.display_name]),
  );
  const options = (employeesResult.data ?? [])
    .filter((row) => row.id !== employee.id)
    .map((row) => ({
      id: row.id,
      displayName: row.display_name,
      access: accessState(row),
    }));
  const row = completionResult.data;
  let completion: CompletedSale | null = null;
  if (row) {
    if (
      !row.completed_on ||
      typeof row.reference !== 'string' ||
      !row.confirmed_at ||
      typeof row.version !== 'number'
    )
      throw new ApiError(503, 'unavailable');
    completion = {
      id: row.id,
      propertyId: row.property_id,
      creditedEmployeeId: row.credited_employee_id,
      creditedEmployeeName: names.get(row.credited_employee_id) ?? '',
      completedOn: row.completed_on,
      reference: row.reference,
      previousStatus: row.previous_status,
      version: row.version,
      confirmedByName: row.confirmed_by
        ? (names.get(row.confirmed_by) ?? '')
        : '',
      confirmedAt: row.confirmed_at,
    };
  }
  // A legacy sold property without a logical completion stays unknown attribution: it cannot
  // be completed after the fact, and the ranking reports it separately rather than guessing.
  const blocked: SaleCompletionBlock = completion
    ? null
    : property.archived_at
      ? 'archived'
      : rentalResult.data
        ? 'rental'
        : property.status !== 'available' && property.status !== 'negotiating'
          ? 'status'
          : options.length === 0
            ? 'no-credited-employee'
            : null;
  const suggested = claimResult.data;
  return {
    today: vietnamToday(),
    status: property.status,
    blocked,
    suggestedCloser:
      suggested && suggested.requested_by
        ? {
            id: suggested.requested_by,
            name: suggested.employee_name ?? '',
          }
        : null,
    employees: options,
    completion,
  };
}

export async function completeSale(
  context: RouteContext,
  employee: Employee,
  id: string,
  body: Record<string, unknown>,
): Promise<SaleCompletionResult> {
  reviewer(employee);
  const completedOn = completionDate(body.completedOn);
  const reference = completionReference(body.reference);
  if (
    !uuid(id) ||
    !uuid(body.creditedEmployeeId) ||
    !uuid(body.key) ||
    !completedOn ||
    !reference ||
    Object.keys(body).some(
      (key) =>
        !['creditedEmployeeId', 'completedOn', 'reference', 'key'].includes(
          key,
        ),
    )
  )
    throw new ApiError(400, 'invalid-input');
  const { error } = await context.client.rpc('complete_property_sale', {
    p_property_id: id,
    p_credited_employee_id: body.creditedEmployeeId,
    p_completed_on: completedOn,
    p_reference: reference,
    p_key: body.key,
  });
  if (error) throw workflowError(error);
  // The completion recorded a status, so the property's summary is read back from the server for
  // the browser's catalogue alongside the fresh state.
  return {
    ...(await saleCompletionState(context, employee, id)),
    summary: await catalogueSummaryOf(context, id),
  };
}
