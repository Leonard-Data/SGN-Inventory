import 'server-only';
import { ApiError, uuid, type RouteContext } from '@/lib/supabase/route';
import {
  COMMENT_MAX_LENGTH,
  COMMENT_PAGE_SIZE,
  COMMENT_REASON_MAX_LENGTH,
  type Comment,
  type CommentPage,
  type CommentRemovalKind,
} from './types';

// The exposed discussion page is at most 30 entries; one extra row is the follow-page probe.
const timestamp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/;

function databaseError(error: { code?: string }) {
  const denied = error.code === '42501';
  throw new ApiError(
    denied ? 403 : 503,
    denied ? 'access-denied' : 'unavailable',
  );
}
// Rows arrive from the guarded RPC or a live read; never trust their shape. The text and the
// removal marker are one state: exactly one of them is present.
function comment(row: unknown): Comment {
  const value: Record<string, unknown> =
    row && typeof row === 'object' && !Array.isArray(row)
      ? (row as Record<string, unknown>)
      : {};
  const removedAt = value.removed_at;
  if (
    !uuid(value.id) ||
    !uuid(value.property_id) ||
    !uuid(value.author_id) ||
    typeof value.author_name !== 'string' ||
    (typeof value.body !== 'string' && value.body !== null) ||
    typeof value.created_at !== 'string' ||
    !uuid(value.revision) ||
    (typeof removedAt !== 'string' && removedAt !== null) ||
    (value.body === null) !== (removedAt !== null) ||
    (removedAt !== null && !timestamp.test(removedAt))
  )
    throw new ApiError(503, 'unavailable');
  return {
    id: value.id,
    propertyId: value.property_id,
    authorId: value.author_id,
    authorName: value.author_name,
    body: value.body,
    createdAt: value.created_at,
    revision: value.revision,
    removedAt,
  };
}

export async function commentPage(
  context: RouteContext,
  id: string,
  params: URLSearchParams,
): Promise<CommentPage> {
  if (!uuid(id)) throw new ApiError(400, 'invalid-input');
  const before = params.get('before'),
    beforeId = params.get('beforeId');
  if (
    [...params.keys()].some((key) => key !== 'before' && key !== 'beforeId') ||
    !!before !== !!beforeId ||
    (before !== null &&
      (!timestamp.test(before) ||
        !Number.isFinite(Date.parse(before)) ||
        !uuid(beforeId)))
  )
    throw new ApiError(400, 'invalid-input');
  const { data, error } = await context.client.rpc('list_property_comments', {
    p_property_id: id,
    p_limit: COMMENT_PAGE_SIZE + 1,
    ...(before && beforeId
      ? { p_before_created_at: before, p_before_id: beforeId }
      : {}),
  });
  if (error) databaseError(error);
  const rows = data ?? [];
  const page = rows.slice(0, COMMENT_PAGE_SIZE);
  const last = page.at(-1);
  return {
    comments: page.map(comment),
    nextCursor:
      rows.length > COMMENT_PAGE_SIZE && last
        ? { before: last.created_at, beforeId: last.id }
        : null,
  };
}

export async function postComment(
  context: RouteContext,
  id: string,
  body: Record<string, unknown>,
): Promise<Comment> {
  if (
    !uuid(id) ||
    Object.keys(body).some((key) => key !== 'body' && key !== 'key') ||
    typeof body.body !== 'string' ||
    !uuid(body.key)
  )
    throw new ApiError(400, 'invalid-input');
  // Application boundary mirrors the database: trim, then 1–2000 characters of source text.
  const text = body.body.trim();
  const length = [...text].length;
  if (length < 1 || length > COMMENT_MAX_LENGTH)
    throw new ApiError(400, 'invalid-input');
  const { data, error } = await context.client.rpc('post_property_comment', {
    p_property_id: id,
    p_body: text,
    p_key: body.key,
  });
  if (error) {
    if (error.code === '42501') throw new ApiError(403, 'access-denied');
    if (error.code === '23505') throw new ApiError(409, 'comment-conflict');
    if (error.code === '23514') throw new ApiError(400, 'invalid-input');
    throw new ApiError(503, 'unavailable');
  }
  return comment(data);
}

// Removal is the only mutation of a posted comment. The actor, time and retained evidence are
// derived inside the guarded RPC; this boundary only validates the request shape.
export async function removeComment(
  context: RouteContext,
  id: string,
  commentId: string,
  body: Record<string, unknown>,
): Promise<Comment> {
  const kind = body.kind;
  if (
    !uuid(id) ||
    !uuid(commentId) ||
    !uuid(body.revision) ||
    (kind !== 'author' && kind !== 'moderation') ||
    Object.keys(body).some(
      (key) => key !== 'revision' && key !== 'kind' && key !== 'reason',
    )
  )
    throw new ApiError(400, 'invalid-input');
  let reason: string | undefined;
  if (kind === 'moderation') {
    if (typeof body.reason !== 'string')
      throw new ApiError(400, 'invalid-input');
    // Application boundary mirrors the database trim, then requires nonblank text.
    const text = body.reason.trim();
    const length = [...text].length;
    if (length < 1 || length > COMMENT_REASON_MAX_LENGTH)
      throw new ApiError(400, 'invalid-input');
    reason = text;
  } else if (body.reason !== undefined && body.reason !== null) {
    // Author removal carries no moderation reason; the database rejects a forged one too.
    throw new ApiError(400, 'invalid-input');
  }
  const { data, error } = await context.client.rpc('remove_property_comment', {
    p_property_id: id,
    p_comment_id: commentId,
    p_revision: body.revision,
    p_kind: kind as CommentRemovalKind,
    ...(reason === undefined ? {} : { p_reason: reason }),
  });
  if (error) {
    if (error.code === '42501') throw new ApiError(403, 'access-denied');
    if (error.code === '23514') throw new ApiError(400, 'invalid-input');
    if (error.code === 'PT409' || error.code === '23505')
      throw new ApiError(409, 'stale-comment');
    throw new ApiError(503, 'unavailable');
  }
  return comment(data);
}
