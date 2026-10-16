import 'server-only';
import type { Database } from '@/types/database';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import {
  changes,
  databaseError,
  exactKeys,
  revisions,
  target,
} from '@/features/property-maintenance/data';
import { requireReadableProperty } from '@/features/properties/property-access';
function explanation(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.trim().length < 10 ||
    value.length > 2000
  )
    throw new ApiError(400, 'invalid-input');
  return value;
}
export async function correctionPage(
  context: RouteContext,
  params: URLSearchParams,
) {
  const property = params.get('propertyId'),
    after = params.get('after');
  if (
    [...params.keys()].some((k) => !['propertyId', 'after'].includes(k)) ||
    (property && !uuid(property)) ||
    (after && !uuid(after))
  )
    throw new ApiError(400, 'invalid-input');
  if (property) await requireReadableProperty(context, property);
  let request = context.client
    .from('correction_requests')
    .select('*,correction_amendments(*)')
    .order('ordinal', {
      referencedTable: 'correction_amendments',
      ascending: false,
    })
    .limit(1, { referencedTable: 'correction_amendments' })
    .order('id')
    .limit(31);
  if (property) request = request.eq('property_id', property);
  if (after) request = request.gt('id', after);
  const { data, error } = await request;
  databaseError(error);
  const requests = (data ?? []).slice(0, 30);
  const amendments = requests.flatMap(
    (request) => request.correction_amendments,
  );
  const properties = requests.length
    ? await context.client
        .from('properties')
        .select('id,property_code')
        .in('id', [...new Set(requests.map((r) => r.property_id))])
    : { data: [], error: null };
  databaseError(properties.error);
  const actorIds = [
    ...new Set([
      ...requests.flatMap((r) => [
        r.requester_id,
        ...(r.outcome_actor_id ? [r.outcome_actor_id] : []),
      ]),
      ...amendments.map((a) => a.actor_id),
    ]),
  ];
  const actors = actorIds.length
    ? await context.client
        .from('employees')
        .select('id,display_name')
        .in('id', actorIds)
    : { data: [], error: null };
  databaseError(actors.error);
  return {
    requests,
    amendments,
    properties: properties.data ?? [],
    actors: actors.data ?? [],
    nextCursor: (data?.length ?? 0) > 30 ? requests.at(-1)!.id : null,
  };
}
export async function correctionDetail(
  context: RouteContext,
  id: string,
  params: URLSearchParams,
) {
  const propertyId = params.get('propertyId');
  if (
    !uuid(id) ||
    !uuid(propertyId) ||
    [...params.keys()].some((key) => key !== 'propertyId')
  )
    throw new ApiError(400, 'invalid-input');
  await requireReadableProperty(context, propertyId);
  const { data, error } = await context.client
    .from('correction_requests')
    .select('*')
    .eq('id', id)
    .eq('property_id', propertyId)
    .maybeSingle();
  databaseError(error);
  if (!data) throw new ApiError(404, 'not-found');
  const amendment = await context.client
    .from('correction_amendments')
    .select('proposed_values')
    .eq('request_id', id)
    .order('ordinal', { ascending: false })
    .limit(1);
  databaseError(amendment.error);
  return {
    request: data,
    proposal: amendment.data?.[0]?.proposed_values ?? data.proposed_values,
  };
}
export async function submitCorrection(
  context: RouteContext,
  body: Record<string, unknown>,
) {
  exactKeys(body, [
    'propertyId',
    'target',
    'targetId',
    'category',
    'explanation',
    'changes',
    'revision',
    'propertyRevision',
  ]);
  const kind = target(body.target),
    rev = revisions(body);
  if (
    !uuid(body.propertyId) ||
    kind === 'mapping' ||
    !['incorrect', 'missing', 'other'].includes(String(body.category))
  )
    throw new ApiError(400, 'invalid-input');
  const { data, error } = await context.client.rpc('submit_correction', {
    p_property_id: body.propertyId,
    p_target: kind,
    p_target_id: rev.targetId,
    p_category: body.category as string,
    p_explanation: explanation(body.explanation),
    p_changes: changes(kind, body.changes),
    p_revision: rev.revision,
    p_property_revision: rev.propertyRevision,
  });
  databaseError(error);
  return { id: data };
}
export async function transitionCorrection(
  context: RouteContext,
  id: string,
  body: Record<string, unknown>,
) {
  if (
    !uuid(id) ||
    !uuid(body.requestRevision) ||
    !['amend', 'apply', 'reject', 'withdraw'].includes(String(body.action))
  )
    throw new ApiError(400, 'invalid-input');
  if (body.action === 'amend') {
    exactKeys(body, [
      'action',
      'requestRevision',
      'explanation',
      'changes',
      'revision',
      'propertyRevision',
    ]);
    if (!uuid(body.revision) || !uuid(body.propertyRevision))
      throw new ApiError(400, 'invalid-input');
    const request = await context.client
      .from('correction_requests')
      .select('target')
      .eq('id', id)
      .maybeSingle();
    databaseError(request.error);
    if (!request.data) throw new ApiError(404, 'not-found');
    const { error } = await context.client.rpc('amend_correction', {
      p_request_id: id,
      p_request_revision: body.requestRevision,
      p_explanation: explanation(body.explanation),
      p_changes: changes(target(request.data.target), body.changes),
      p_revision: body.revision,
      p_property_revision: body.propertyRevision,
    });
    databaseError(error);
  } else {
    exactKeys(body, ['action', 'requestRevision', 'reason']);
    const reason = body.action === 'withdraw' ? null : explanation(body.reason);
    const { error } = await context.client.rpc('decide_correction', {
      p_request_id: id,
      p_request_revision: body.requestRevision,
      p_action: body.action as string,
      p_reason: reason,
    });
    databaseError(error);
  }
  return { ok: true };
}
export type CorrectionPage = Awaited<ReturnType<typeof correctionPage>>;
export type Correction =
  Database['public']['Tables']['correction_requests']['Row'];
export async function amendmentPage(
  context: RouteContext,
  id: string,
  params: URLSearchParams,
) {
  const propertyId = params.get('propertyId'),
    after = params.get('after'),
    ordinal = after === null ? 0 : Number(after);
  if (
    !uuid(id) ||
    !uuid(propertyId) ||
    [...params.keys()].some((k) => !['propertyId', 'after'].includes(k)) ||
    (after !== null && !/^(0|[1-9][0-9]*)$/.test(after)) ||
    !Number.isInteger(ordinal) ||
    ordinal < 0 ||
    ordinal > 2147483647
  )
    throw new ApiError(400, 'invalid-input');
  await requireReadableProperty(context, propertyId);
  const parent = await context.client
    .from('correction_requests')
    .select('id')
    .eq('id', id)
    .eq('property_id', propertyId)
    .maybeSingle();
  databaseError(parent.error);
  if (!parent.data) throw new ApiError(404, 'not-found');
  const { data, error } = await context.client
    .from('correction_amendments')
    .select('*')
    .eq('request_id', id)
    .gt('ordinal', ordinal)
    .order('ordinal')
    .limit(21);
  databaseError(error);
  const amendments = (data ?? []).slice(0, 20),
    actorIds = [...new Set(amendments.map((a) => a.actor_id))];
  const actors = actorIds.length
    ? await context.client
        .from('employees')
        .select('id,display_name')
        .in('id', actorIds)
    : { data: [], error: null };
  databaseError(actors.error);
  return {
    amendments,
    actors: actors.data ?? [],
    nextCursor: (data?.length ?? 0) > 20 ? amendments.at(-1)!.ordinal : null,
  };
}
export type AmendmentPage = Awaited<ReturnType<typeof amendmentPage>>;
