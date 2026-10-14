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
    if (row.removedAt !== null) return row;
    if (
      existing.editedAt !== null &&
      (row.editedAt === null ||
        timestampKey(row.editedAt) <= timestampKey(existing.editedAt))
    )
      return existing;
    return row;
  });
}

function timestampKey(value: string): string {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(
      value,
    );
  return match ? `${match[1]}.${(match[2] ?? '').padEnd(6, '0')}` : value;
}

export function mergeStaleEditState(
  current: Comment[],
  page: Comment[],
  comment: Comment | null,
): Comment[] {
  const pageRows = mergePage(current, page);
  const incoming = new Map(pageRows.map((row) => [row.id, row]));
  let mergedComment: Comment | null = null;
  if (comment) {
    const existing =
      incoming.get(comment.id) ?? current.find((row) => row.id === comment.id);
    mergedComment =
      mergePage(existing ? [existing] : [], [comment]).at(0) ?? comment;
    incoming.set(comment.id, mergedComment);
  }
  const seen = new Set<string>();
  const rows = current.map((row) => {
    const next = incoming.get(row.id) ?? row;
    seen.add(row.id);
    return next;
  });
  const fresh = pageRows
    .filter((row) => !seen.has(row.id))
    .map((row) => incoming.get(row.id) ?? row);
  if (
    comment &&
    mergedComment &&
    !seen.has(comment.id) &&
    !fresh.some((row) => row.id === comment.id)
  )
    return [...fresh, ...rows, mergedComment];
  return [...fresh, ...rows];
}

export function retainEditTarget(
  rows: Comment[],
  previous: Comment[],
  id: string | null,
): Comment[] {
  if (!id || rows.some((row) => row.id === id)) return rows;
  const target = previous.find((row) => row.id === id);
  return target ? [...rows, target] : rows;
}
