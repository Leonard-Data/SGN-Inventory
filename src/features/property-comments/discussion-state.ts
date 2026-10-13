import {
  COMMENT_PAGE_SIZE,
  type Comment,
  type CommentCursor,
} from './types.ts';

export const cursorOf = (row: Comment | undefined): CommentCursor | null =>
  row ? { before: row.createdAt, beforeId: row.id } : null;

export function withPost(created: Comment, page: Comment[], more: boolean) {
  const rows = [created, ...page.filter((row) => row.id !== created.id)].slice(
    0,
    COMMENT_PAGE_SIZE,
  );
  return { rows, next: more ? cursorOf(rows.at(-1)) : null };
}

export function mergePage(current: Comment[], page: Comment[]): Comment[] {
  const local = new Map(current.map((row) => [row.id, row]));
  return page.map((row) => {
    const existing = local.get(row.id);
    if (!existing) return row;
    if (existing.removedAt !== null && row.removedAt === null) return existing;
    if (existing.editedAt !== null && row.editedAt === null) return existing;
    return row;
  });
}

export function mergePageKeepingComment(
  current: Comment[],
  page: Comment[],
  commentId: string,
): Comment[] {
  const merged = mergePage(current, page);
  if (merged.some((row) => row.id === commentId)) return merged;
  const existing = current.find((row) => row.id === commentId);
  return existing ? [...merged, existing] : merged;
}
