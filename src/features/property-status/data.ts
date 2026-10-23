import 'server-only';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import { isUuid, timestamp } from '@/lib/supabase/query';
import { catalogueSummaryOf } from '@/features/properties/catalogue-data';

// One recorded status event. `pending` is a sold/rented request a reviewer has not decided yet;
// `applied` and `rejected` are terminal and name the decider. A direct change has no separate
// decider: the actor who made it is the only party.
export type StatusChange = {
  id: string;
  property_id: string;
  origin: 'direct' | 'request';
  state: 'pending' | 'applied' | 'rejected';
  from_status: string;
  to_status: string;
  requested_by: string;
  requested_by_name: string;
  requested_at: string;
  note: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_reason: string | null;
};

// The values the property row itself allows; the database refuses anything else, this only states
// the same vocabulary to the caller before a round trip.
const STATUSES = [
  'draft',
  'available',
  'negotiating',
  'sold',
  'rented',
  'withdrawn',
] as const;
export const statusValues: readonly string[] = STATUSES;
const NOTE_MAX = 500;
const REASON_MIN = 10;
const REASON_MAX = 2000;

// Every refusal the workflow raises carries its own reason, so the surface can say what happened
// instead of a generic failure.
export function statusError(error: { code?: string } | null) {
  if (!error) return;
  const code = error.code;
  if (code === '42501') throw new ApiError(403, 'access-denied');
  if (code === 'P0017') throw new ApiError(409, 'property-archived');
  if (code === 'P0002') throw new ApiError(404, 'not-found');
  if (code === 'P0027') throw new ApiError(409, 'status-request-pending');
  if (code === 'P0028') throw new ApiError(409, 'status-request-decided');
  if (code === 'P0029') throw new ApiError(409, 'status-changed');
  if (code === 'P0030') throw new ApiError(400, 'status-unchanged');
  if (
    ['22023', '23514', '23502', '22P02', '22003', 'P0001'].includes(code ?? '')
  )
    throw new ApiError(400, 'invalid-input');
  throw new ApiError(503, 'unavailable');
}

function change(value: unknown): StatusChange {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError(503, 'unavailable');
  return value as StatusChange;
}

// The status a person asked for, and the optional note they typed beside it. The note is kept as
// source text (trimmed), and an empty note is no note at all rather than an empty string.
export function statusWrite(body: Record<string, unknown>) {
  if (
    typeof body.status !== 'string' ||
    !STATUSES.includes(body.status as (typeof STATUSES)[number])
  )
    throw new ApiError(400, 'invalid-input');
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string' || body.note.length > NOTE_MAX)
      throw new ApiError(400, 'invalid-input');
  }
  return {
    status: body.status,
    note:
      typeof body.note === 'string' && body.note.trim() !== ''
        ? body.note.trim()
        : null,
  };
}

export async function setStatus(
  context: RouteContext,
  id: string,
  body: Record<string, unknown>,
) {
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  const write = statusWrite(body);
  const { data, error } = await context.client.rpc('set_property_status', {
    p_property_id: id,
    p_status: write.status,
    p_note: write.note,
  });
  statusError(error);
  // The catalogued status comes from the server's own read after the change, so the list shows
  // what was applied (or requested) rather than what the picker submitted.
  return {
    change: change(data),
    summary: await catalogueSummaryOf(context, id),
  };
}

// The trail of one property, oldest first, so the record reads as the story it is. A record nobody
// can read answers not-found, exactly as its change history does.
export async function statusTrail(context: RouteContext, id: string) {
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  const parent = await context.client
    .from('properties')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  statusError(parent.error);
  if (!parent.data) throw new ApiError(404, 'not-found');
  const { data, error } = await context.client
    .from('property_status_changes')
    .select('*')
    .eq('property_id', id)
    .order('requested_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(200);
  statusError(error);
  return { changes: (data ?? []) as StatusChange[] };
}

// The queue a manager or admin works through: the requests nobody has decided yet, oldest first,
// each with the record it is about. The ascending keyset names both cursor parts, so a partial one
// is refused rather than read as "no cursor".
export async function pendingStatusRequests(
  context: RouteContext,
  params: URLSearchParams,
) {
  const after = params.get('after'),
    afterId = params.get('afterId');
  if (
    [...params.keys()].some((k) => !['after', 'afterId'].includes(k)) ||
    ((after !== null || afterId !== null) &&
      !(
        after !== null &&
        afterId !== null &&
        timestamp.test(after) &&
        Number.isFinite(Date.parse(after)) &&
        isUuid(afterId)
      ))
  )
    throw new ApiError(400, 'invalid-input');
  let request = context.client
    .from('property_status_changes')
    .select('*')
    .eq('state', 'pending')
    .order('requested_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(31);
  if (after !== null && afterId !== null)
    request = request.or(
      `requested_at.gt.${after},and(requested_at.eq.${after},id.gt.${afterId})`,
    );
  const { data, error } = await request;
  statusError(error);
  const changes = (data ?? []).slice(0, 30) as StatusChange[];
  const properties = changes.length
    ? await context.client
        .from('properties')
        .select('id,property_code')
        .in('id', [...new Set(changes.map((row) => row.property_id))])
    : { data: [], error: null };
  statusError(properties.error);
  const last = changes.at(-1);
  return {
    changes,
    properties: properties.data ?? [],
    nextCursor:
      (data?.length ?? 0) > 30 && last
        ? { after: last.requested_at, afterId: last.id }
        : null,
  };
}

// A decided case keeps its decision on the same row. The reason is the reviewer's own words and is
// required either way, and an already-decided case is refused rather than decided twice.
export async function decideStatusRequest(
  context: RouteContext,
  id: string,
  body: Record<string, unknown>,
) {
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  if (typeof body.approve !== 'boolean')
    throw new ApiError(400, 'invalid-input');
  if (
    typeof body.reason !== 'string' ||
    body.reason.trim().length < REASON_MIN ||
    body.reason.length > REASON_MAX
  )
    throw new ApiError(400, 'invalid-input');
  const { data, error } = await context.client.rpc('decide_status_request', {
    p_change_id: id,
    p_approve: body.approve,
    p_reason: body.reason.trim(),
  });
  statusError(error);
  const decided = change(data);
  // An approval applied the requested status, so the property's summary is read back from the
  // server for the browser's catalogue; a rejection applied nothing and answers the same current
  // state.
  return {
    change: decided,
    summary: await catalogueSummaryOf(context, decided.property_id),
  };
}

export type StatusTrailPage = Awaited<ReturnType<typeof statusTrail>>;
export type StatusRequestQueue = Awaited<
  ReturnType<typeof pendingStatusRequests>
>;
