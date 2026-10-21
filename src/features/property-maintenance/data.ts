import 'server-only';
import type { Json } from '@/types/database';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import { cursorPair } from '@/lib/supabase/query';
import { catalogueSummaryOf } from '@/features/properties/catalogue-data';
import {
  InputError,
  validateChanges,
  targetFields,
  type Target,
} from './fields';
import { isReportDate } from '@/features/employees/report-range';
import { offeredUnits } from './units';

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
  // The catalogue summary comes from the server's own read of the committed record, never from the
  // submitted facts, so the browser's list can take the change without guessing at it.
  const id = data as string;
  return { id, summary: await catalogueSummaryOf(context, id) };
}
// An optional explanation is a correction note, not another business field: it is only
// accepted on an authorized price edit and the database attaches it to that revision's
// own history entries. Unknown or non-price explanations are refused, never dropped.
function correctionExplanation(
  value: unknown,
  kind: Target,
  changed: Record<string, Json>,
): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'string' ||
    value.trim().length < 10 ||
    value.length > 2000
  )
    throw new ApiError(400, 'invalid-input');
  if (
    kind !== 'property' ||
    !(
      Object.hasOwn(changed, 'sale_price_vnd') ||
      Object.hasOwn(changed, 'monthly_rent_vnd')
    )
  )
    throw new ApiError(400, 'explanation-without-price');
  return value;
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
    'explanation',
  ]);
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  const kind = target(body.target),
    rev = revisions(body),
    changed = changes(kind, body.changes),
    explanation = correctionExplanation(body.explanation, kind, changed);
  const { error } = await context.client.rpc('maintain_property', {
    p_property_id: id,
    p_target: kind,
    p_target_id: rev.targetId,
    p_expected_revision: rev.revision,
    p_property_revision: rev.propertyRevision,
    p_changes: changed,
    p_explanation: explanation,
  });
  databaseError(error);
  // An address edit reindexes the same property, so the summary is read back from the server after
  // the change rather than assembled from what was submitted.
  return { id, summary: await catalogueSummaryOf(context, id) };
}
export async function contactDetail(context: RouteContext, id: string) {
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  // The guarded impact RPC denies incomplete affected-property disclosure before the
  // response is built; the identity read is independent, so it goes out with it in one
  // round trip rather than a waterfall.
  const [impact, contact] = await Promise.all([
    context.client.rpc('contact_impact', { p_contact_id: id }),
    context.client
      .from('contacts')
      .select(
        'id,revision,display_name,phones,raw_phone_text,contact_type,notes',
      )
      .eq('id', id)
      .maybeSingle(),
  ]);
  databaseError(impact.error);
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
    parent = params.get('parent'),
    on = params.get('on'),
    include = params.get('include');
  if (
    [...params.keys()].some(
      (k) => !['level', 'parent', 'on', 'include'].includes(k),
    ) ||
    !['province', 'district', 'commune'].includes(level ?? '') ||
    (level !== 'province' && !uuid(parent) && !uuid(include)) ||
    (level === 'province' && parent !== null) ||
    (on !== null && !isReportDate(on)) ||
    (include !== null && !uuid(include))
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
  // A level whose parent is not chosen yet lists nothing; only the recorded unit it names comes
  // back, which is how a ward recorded under a district the form no longer holds still resolves.
  else if (level !== 'province' && include) request = request.eq('id', include);
  const { data, error } = await request;
  databaseError(error);
  // The day rule is applied here so it is defined once; shortcut: a level and parent group over
  // 1,000 rows would hit the page cap before the filter, upgrade when one does.
  const offers = offeredUnits(data ?? [], on, include);
  // A recorded identifier that belongs to another generation is in no dated list at all, so its own
  // row answers with the official name and keeps the value selectable beside the list.
  if (include && !offers.some((unit) => unit.id === include)) {
    const { data: recorded, error: lookup } = await context.client
      .from('admin_unit_versions')
      .select('id,name_vi,unit_level,parent_id,valid_from,valid_to')
      .eq('id', include)
      .eq('unit_level', level!)
      .maybeSingle();
    databaseError(lookup);
    if (recorded) offers.push(recorded);
  }
  return { units: offers };
}
export async function historyPage(
  context: RouteContext,
  id: string,
  params: URLSearchParams,
) {
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  const cursor = cursorPair(params);
  if (
    [...params.keys()].some((k) => !['before', 'beforeId'].includes(k)) ||
    cursor === 'invalid'
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
  if (cursor)
    request = request.or(
      `occurred_at.lt.${cursor.before},and(occurred_at.eq.${cursor.before},id.lt.${cursor.beforeId})`,
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
export type PriceSeries = 'sale' | 'rent';
export type PriceChange = {
  id: string;
  actor_name: string;
  occurred_at: string;
  explanation: string | null;
  before: string | null;
  after: string | null;
};
// One recorded price series at a time: sale asking prices and monthly asking rents are
// separate units, and each series keyset-pages past the single generic history page.
// Values stay exact whole-VND text extracted by the view; null is an unknown gap, never 0.
export async function priceHistoryPage(
  context: RouteContext,
  id: string,
  params: URLSearchParams,
) {
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  const series = params.get('series'),
    cursor = cursorPair(params);
  if (
    [...params.keys()].some(
      (k) => !['series', 'before', 'beforeId'].includes(k),
    ) ||
    (series !== 'sale' && series !== 'rent') ||
    cursor === 'invalid'
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
    .from('property_price_history')
    .select('id,actor_name,occurred_at,explanation,before_value,after_value')
    .eq('property_id', id)
    .eq('series', series)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(31);
  if (cursor)
    request = request.or(
      `occurred_at.lt.${cursor.before},and(occurred_at.eq.${cursor.before},id.lt.${cursor.beforeId})`,
    );
  const { data, error } = await request;
  databaseError(error);
  const page = (data ?? []).slice(0, 30),
    last = page.at(-1);
  return {
    events: page.map((event): PriceChange => ({
      id: event.id!,
      actor_name: event.actor_name!,
      occurred_at: event.occurred_at!,
      explanation: event.explanation,
      before: event.before_value,
      after: event.after_value,
    })),
    nextCursor:
      (data?.length ?? 0) > 30 && last
        ? { before: last.occurred_at!, beforeId: last.id! }
        : null,
  };
}
export type PriceHistoryPage = Awaited<ReturnType<typeof priceHistoryPage>>;
export type HistoryPage = Awaited<ReturnType<typeof historyPage>>;
export type ContactDetail = Awaited<ReturnType<typeof contactDetail>>;
export type Unit = Awaited<ReturnType<typeof listUnits>>['units'][number];
