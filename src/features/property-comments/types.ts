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
// The database-row validator: PostgREST returns snake_case columns. An untrusted shape maps to
// null instead of a partial object.
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
// The application wire shape: the JSON API serializes `Comment` with camelCase fields, so a
// serialized comment must not be validated as a database row.
export function toWireComment(value: unknown): Comment | null {
  const row: Record<string, unknown> =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  if (
    typeof row.id !== 'string' ||
    !uuidPattern.test(row.id) ||
    typeof row.propertyId !== 'string' ||
    !uuidPattern.test(row.propertyId) ||
    typeof row.authorId !== 'string' ||
    !uuidPattern.test(row.authorId) ||
    typeof row.authorName !== 'string' ||
    typeof row.body !== 'string' ||
    typeof row.createdAt !== 'string' ||
    typeof row.revision !== 'string' ||
    !uuidPattern.test(row.revision) ||
    (row.editedAt !== null && typeof row.editedAt !== 'string')
  )
    return null;
  return {
    id: row.id,
    propertyId: row.propertyId,
    authorId: row.authorId,
    authorName: row.authorName,
    body: row.body,
    createdAt: row.createdAt,
    revision: row.revision,
    editedAt: row.editedAt as string | null,
  };
}
