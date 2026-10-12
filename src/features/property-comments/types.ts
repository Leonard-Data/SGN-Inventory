export const COMMENT_PAGE_SIZE = 30;
export const COMMENT_MAX_LENGTH = 2000;
export interface Comment {
  id: string;
  propertyId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  revision: string;
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
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// One validator for every comment row the app returns, whether read on the server or received
// in a conflict payload; an untrusted shape maps to null instead of a partial object.
export function toComment(row: unknown): Comment | null {
  const value: Record<string, unknown> =
    row && typeof row === 'object' && !Array.isArray(row)
      ? (row as Record<string, unknown>)
      : {};
  if (
    typeof value.id !== 'string' ||
    !uuidPattern.test(value.id) ||
    typeof value.property_id !== 'string' ||
    !uuidPattern.test(value.property_id) ||
    typeof value.author_id !== 'string' ||
    !uuidPattern.test(value.author_id) ||
    typeof value.author_name !== 'string' ||
    typeof value.body !== 'string' ||
    typeof value.created_at !== 'string' ||
    typeof value.revision !== 'string' ||
    !uuidPattern.test(value.revision) ||
    (value.edited_at !== null && typeof value.edited_at !== 'string')
  )
    return null;
  return {
    id: value.id,
    propertyId: value.property_id,
    authorId: value.author_id,
    authorName: value.author_name,
    body: value.body,
    createdAt: value.created_at,
    revision: value.revision,
    editedAt: value.edited_at as string | null,
  };
}
