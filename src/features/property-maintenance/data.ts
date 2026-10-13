import 'server-only';
import type { Json } from '@/types/database';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import {
  InputError,
  validateChanges,
  targetFields,
  type Target,
} from './fields';

export function databaseError(error: { code?: string } | null) {
  if (!error) return;
  const code = error.code;
  if (code === '42501') throw new ApiError(403, 'access-denied');
  if (code === 'PT403') throw new ApiError(403, 'contact-refusal');
  if (code === 'PT409') throw new ApiError(409, 'stale-edit');
  if (code === '23505') throw new ApiError(409, 'conflict');
  if (
    [
      '23514',
      '23502',
      '23503',
      '22P02',
      '22003',
      '22007',
      '22008',
      'P0001',
    ].includes(code ?? '')
  )
    throw new ApiError(400, 'invalid-input');
  throw new ApiError(503, 'unavailable');
}
export function exactKeys(
  body: Record<string, unknown>,
  keys: readonly string[],
) {
  if (Object.keys(body).some((k) => !keys.includes(k)))
    throw new ApiError(400, 'invalid-input');
}
export function target(value: unknown): Target {
  if (typeof value !== 'string' || !Object.hasOwn(targetFields, value))
    throw new ApiError(400, 'invalid-input');
  return value as Target;
}
export function changes(kind: Target, value: unknown): Record<string, Json> {
  try {
    return validateChanges(kind, value);
  } catch (error) {
    if (error instanceof InputError) throw new ApiError(400, 'invalid-input');
    throw error;
  }
}
export function revisions(body: Record<string, unknown>) {
  if (
    !uuid(body.revision) ||
    !uuid(body.propertyRevision) ||
    !(body.targetId === null || uuid(body.targetId))
  )
    throw new ApiError(400, 'invalid-input');
  return {
    revision: body.revision,
    propertyRevision: body.propertyRevision,
    targetId: body.targetId,
  };
}
export async function createProperty(
  context: RouteContext,
  body: Record<string, unknown>,
) {
  exactKeys(body, ['mode', 'facts', 'address']);
  if (!['sale', 'rent', 'both'].includes(String(body.mode)))
    throw new ApiError(400, 'invalid-input');
  const facts = changes('property', body.facts),
    address = changes('address', body.address);
  if (
    !address.address_text ||
    !['legacy', 'current'].includes(String(address.format)) ||
    Object.hasOwn(facts, 'status')
  )
    throw new ApiError(400, 'invalid-input');
  const { data, error } = await context.client.rpc('create_property', {
    p_mode: body.mode as string,
    p_facts: facts,
    p_address: address,
  });
  databaseError(error);
  return { id: data };
}
export async function maintainProperty(
  context: RouteContext,
  id: string,
  body: Record<string, unknown>,
) {
  exactKeys(body, [
    'target',
    'targetId',
    'revision',
    'propertyRevision',
    'changes',
  ]);
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  const kind = target(body.target),
    rev = revisions(body);
  const { data, error } = await context.client.rpc('maintain_property', {
    p_property_id: id,
    p_target: kind,
    p_target_id: rev.targetId,
    p_expected_revision: rev.revision,
    p_property_revision: rev.propertyRevision,
    p_changes: changes(kind, body.changes),
  });
  databaseError(error);
  return { id: data };
}
export async function contactDetail(context: RouteContext, id: string) {
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  // Guarded impact RPC denies incomplete affected-property disclosure before returning contact data.
  const impact = await context.client.rpc('contact_impact', {
    p_contact_id: id,
  });
  databaseError(impact.error);
  const contact = await context.client
    .from('contacts')
    .select('id,revision,display_name,phones,raw_phone_text,contact_type,notes')
    .eq('id', id)
    .maybeSingle();
  databaseError(contact.error);
  if (!contact.data) throw new ApiError(404, 'not-found');
  return {
    contact: contact.data,
    impact: impact.data as {
      revision: string;
      properties: { id: string; property_code: string }[];
    },
  };
}
export async function listContacts(
  context: RouteContext,
  params: URLSearchParams,
) {
  const query = params.get('query') ?? '',
    after = params.get('after');
  if (
    [...params.keys()].some((k) => !['query', 'after'].includes(k)) ||
    [...query].length > 120 ||
    (after && !uuid(after))
  )
    throw new ApiError(400, 'invalid-input');
  const literal = query.replace(/[\\%_]/g, '\\$&');
  let request = context.client
    .from('contacts')
    .select('id,display_name,contact_type,phones,raw_phone_text')
    .order('id')
    .limit(31);
  if (query) request = request.ilike('display_name', '%' + literal + '%');
  if (after) request = request.gt('id', after);
  const { data, error } = await request;
  databaseError(error);
  const page = (data ?? []).slice(0, 30);
  return {
    contacts: page,
    nextCursor: (data?.length ?? 0) > 30 ? page.at(-1)!.id : null,
  };
}
export async function createContact(
  context: RouteContext,
  body: Record<string, unknown>,
) {
  exactKeys(body, ['changes']);
  const { data, error } = await context.client.rpc('create_contact', {
    p_changes: changes('contact', body.changes),
  });
  databaseError(error);
  return { id: data };
}
export async function listUnits(
  context: RouteContext,
  params: URLSearchParams,
) {
  const level = params.get('level'),
    parent = params.get('parent');
  if (
    [...params.keys()].some((k) => !['level', 'parent'].includes(k)) ||
    !['province', 'district', 'commune'].includes(level ?? '') ||
    (level !== 'province' && !uuid(parent)) ||
    (level === 'province' && parent !== null)
  )
    throw new ApiError(400, 'invalid-input');
  let request = context.client
    .from('admin_unit_versions')
    .select('id,name_vi,unit_level,parent_id,valid_from,valid_to')
    .eq('unit_level', level!)
    .order('name_vi')
    .order('valid_from', { ascending: false })
    .limit(1000);
  if (parent) request = request.eq('parent_id', parent);
  const { data, error } = await request;
  databaseError(error);
  return { units: data ?? [] };
}
export async function historyPage(
  context: RouteContext,
  id: string,
  params: URLSearchParams,
) {
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  const before = params.get('before'),
    beforeId = params.get('beforeId');
  if (
    [...params.keys()].some((k) => !['before', 'beforeId'].includes(k)) ||
    !!before !== !!beforeId ||
    (before &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(
        before,
      ) ||
        !Number.isFinite(Date.parse(before)) ||
        !uuid(beforeId)))
  )
    throw new ApiError(400, 'invalid-input');
  const parent = await context.client
    .from('properties')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  databaseError(parent.error);
  if (!parent.data) throw new ApiError(404, 'not-found');
  let request = context.client
    .from('property_history')
    .select('*')
    .eq('property_id', id)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(31);
  if (before)
    request = request.or(
      `occurred_at.lt.${before},and(occurred_at.eq.${before},id.lt.${beforeId})`,
    );
  const { data, error } = await request;
  databaseError(error);
  const page = (data ?? []).slice(0, 30),
    last = page.at(-1);
  return {
    events: page,
    nextCursor:
      (data?.length ?? 0) > 30 && last
        ? { before: last.occurred_at, beforeId: last.id }
        : null,
  };
}
export type HistoryPage = Awaited<ReturnType<typeof historyPage>>;
export type ContactDetail = Awaited<ReturnType<typeof contactDetail>>;
export type Unit = Awaited<ReturnType<typeof listUnits>>['units'][number];
