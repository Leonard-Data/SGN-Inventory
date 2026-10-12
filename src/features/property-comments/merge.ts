import type { Comment } from './types';

// A conflict refresh must not drop rows already loaded below the first page, so the row the
// author is editing (and its draft and error) stays on screen. The newest page wins for rows
// it carries; leftover older rows keep their existing newest-first order.
export function mergeComments(page: Comment[], loaded: Comment[]): Comment[] {
  const seen = new Set(page.map((row) => row.id));
  return [...page, ...loaded.filter((row) => !seen.has(row.id))];
}
