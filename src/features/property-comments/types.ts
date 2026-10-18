export const COMMENT_PAGE_SIZE = 30;
export const COMMENT_MAX_LENGTH = 2000;
export const COMMENT_REASON_MAX_LENGTH = 2000;
export type CommentRemovalKind = 'author' | 'moderation';

export type CommentHistoryEvent = {
  kind: 'posting' | 'edit' | 'removal';
  version: number | null;
  body: string;
  actorId: string;
  actorName: string;
  occurredAt: string;
  removalKind: CommentRemovalKind | null;
  reason: string | null;
};
export type CommentHistoryPage = {
  events: CommentHistoryEvent[];
  hasMore: boolean;
};
export interface Comment {
  id: string;
  propertyId: string;
  authorId: string;
  authorName: string;
  /** Null once the text has been withdrawn; the removal marker carries the rest. */
  body: string | null;
  createdAt: string;
  revision: string;
  removedAt: string | null;
  /** Time of the most recent accepted author edit; marks the entry as edited. */
  editedAt: string | null;
}
export type CommentCursor = {
  before: string;
  beforeId: string;
};
export interface CommentPage {
  comments: Comment[];
  nextCursor: CommentCursor | null;
}
