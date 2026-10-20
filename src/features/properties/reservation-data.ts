import 'server-only';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import type { Employee } from '@/features/employees/types';
import { catalogueSummaryOf } from './catalogue-data';
import { decisionDays, reservationReason } from './reservation-rules';
import type {
  EffectiveReservation,
  ReservationRequest,
  ReservationState,
} from './types';

const claim = 'id,requested_by,reason,requested_at,expires_at';

function databaseError(error: { code?: string }): ApiError {
  return error.code === '42501'
    ? new ApiError(403, 'access-denied')
    : new ApiError(503, 'unavailable');
}

// Guarded workflows report invalid transitions without an errcode; 23505 is the one-approved
// reservation or one-pending-request-per-employee exclusivity index.
function workflowError(error: { code?: string }): ApiError {
  if (error.code === '42501') return new ApiError(403, 'access-denied');
  if (error.code === '23505') return new ApiError(409, 'reservation-conflict');
  if (error.code === '23514') return new ApiError(400, 'invalid-input');
  if (error.code === 'P0001')
    return new ApiError(409, 'reservation-unavailable');
  return new ApiError(503, 'unavailable');
}

function timestamp(value: unknown): string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? value
    : '';
}

function claimant(value: unknown): string {
  return typeof value === 'string' && value.length ? value : '';
}

function request(row: unknown, names: Map<string, string>): ReservationRequest {
  const value =
    row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
  const requestedBy = claimant(value.requested_by);
  const requestedAt = timestamp(value.requested_at);
  const expiresAt = timestamp(value.expires_at);
  if (
    !uuid(value.id) ||
    !uuid(requestedBy) ||
    typeof value.reason !== 'string' ||
    !requestedAt ||
    !expiresAt
  )
    throw new ApiError(503, 'unavailable');
  return {
    id: value.id,
    claimantId: requestedBy,
    claimantName: names.get(requestedBy) ?? '',
    reason: value.reason,
    requestedAt,
    expiresAt,
  };
}

// The read contract: approved unexpired reservations are effective for every active employee;
// pending requests are visible to the claimant and to the manager/admin decision surface.
export async function reservationState(
  context: RouteContext,
  employee: Employee,
  id: string,
): Promise<ReservationState> {
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  const canDecide = employee.role === 'manager' || employee.role === 'admin';
  const pendingQuery = context.client
    .from('property_locks')
    .select(claim)
    .eq('property_id', id)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('requested_at');
  const [effectiveResult, pendingResult] = await Promise.all([
    context.client
      .from('v_effective_property_locks')
      .select('id,requested_by,employee_name,decided_at,expires_at')
      .eq('property_id', id)
      .maybeSingle(),
    canDecide ? pendingQuery : pendingQuery.eq('requested_by', employee.id),
  ]);
  if (effectiveResult.error || pendingResult.error)
    throw databaseError(effectiveResult.error ?? pendingResult.error!);
  const rows = pendingResult.data ?? [];
  const ids = [
    ...new Set(
      rows
        .map((row) => row.requested_by)
        .filter((value): value is string => !!value),
    ),
  ];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data, error } = await context.client.rpc('list_employee_names', {
      p_ids: ids,
    });
    if (error) throw databaseError(error);
    for (const row of data ?? []) names.set(row.id, row.display_name);
  }
  const effective = effectiveResult.data;
  let reservation: EffectiveReservation | null = null;
  if (effective) {
    const decidedAt = timestamp(effective.decided_at),
      expiresAt = timestamp(effective.expires_at);
    if (!uuid(effective.id) || !uuid(effective.requested_by) || !expiresAt)
      throw new ApiError(503, 'unavailable');
    reservation = {
      id: effective.id,
      claimantId: effective.requested_by,
      claimantName: effective.employee_name ?? '',
      decidedAt,
      expiresAt,
    };
  }
  return {
    effective: reservation,
    pending: rows.map((row) => request(row, names)),
    canDecide,
    // The property's current catalogued summary, from the server's own read. A lock decision is
    // committed by the database and this is what the record now says, so the browser's catalogue
    // is refreshed from server state - including when a competing lock won and this answer is the
    // only authoritative state the loser gets.
    summary: await catalogueSummaryOf(context, id),
  };
}

export async function requestReservation(
  context: RouteContext,
  employee: Employee,
  id: string,
  body: Record<string, unknown>,
): Promise<ReservationState> {
  const reason = reservationReason(body.reason);
  if (!uuid(id) || !reason || Object.keys(body).some((key) => key !== 'reason'))
    throw new ApiError(400, 'invalid-input');
  const { error } = await context.client.rpc('request_property_lock', {
    p_property_id: id,
    p_reason: reason,
  });
  if (error) throw workflowError(error);
  return reservationState(context, employee, id);
}

export async function releaseReservation(
  context: RouteContext,
  employee: Employee,
  id: string,
  body: Record<string, unknown>,
): Promise<ReservationState> {
  const reason = reservationReason(body.reason);
  if (
    !uuid(id) ||
    !uuid(body.lockId) ||
    !reason ||
    Object.keys(body).some((key) => !['lockId', 'reason'].includes(key))
  )
    throw new ApiError(400, 'invalid-input');
  const { data: lock, error: lockError } = await context.client
    .from('property_locks')
    .select('id,property_id,status')
    .eq('id', body.lockId)
    .maybeSingle();
  if (lockError) throw databaseError(lockError);
  if (!lock || lock.property_id !== id) throw new ApiError(404, 'not-found');
  const { error } = await context.client.rpc('release_property_lock', {
    p_lock_id: body.lockId,
    p_reason: reason,
  });
  if (error) {
    if (error.code === '42501') throw new ApiError(403, 'access-denied');
    // The definer reports both an already-closed lock and a short reason without an errcode;
    // the route validated the reason, so a remaining refusal is a closed reservation.
    if (error.code === 'P0001') throw new ApiError(409, 'reservation-closed');
    if (error.code === '23514') throw new ApiError(400, 'invalid-input');
    throw new ApiError(503, 'unavailable');
  }
  return reservationState(context, employee, id);
}

export async function decideReservation(
  context: RouteContext,
  employee: Employee,
  id: string,
  body: Record<string, unknown>,
): Promise<ReservationState> {
  const reason = reservationReason(body.reason),
    days = decisionDays(body.days);
  if (
    !uuid(id) ||
    !uuid(body.lockId) ||
    typeof body.approve !== 'boolean' ||
    !reason ||
    days === null ||
    Object.keys(body).some(
      (key) => !['lockId', 'approve', 'reason', 'days'].includes(key),
    )
  )
    throw new ApiError(400, 'invalid-input');
  if (employee.role !== 'manager' && employee.role !== 'admin')
    throw new ApiError(403, 'access-denied');
  // The database refuses self approval unconditionally. Reading the claimant first keeps that
  // denial an actionable message instead of the session-level 403 reserved for role failures.
  const { data: lock, error: lockError } = await context.client
    .from('property_locks')
    .select('id,property_id,requested_by')
    .eq('id', body.lockId)
    .maybeSingle();
  if (lockError) throw databaseError(lockError);
  if (!lock || lock.property_id !== id) throw new ApiError(404, 'not-found');
  if (lock.requested_by === employee.id)
    throw new ApiError(409, 'self-approval-forbidden');
  const { error } = await context.client.rpc('decide_property_lock', {
    p_lock_id: body.lockId,
    p_approve: body.approve,
    p_reason: reason,
    p_days: days,
  });
  if (error) throw workflowError(error);
  return reservationState(context, employee, id);
}
