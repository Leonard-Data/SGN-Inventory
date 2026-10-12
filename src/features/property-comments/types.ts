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
interface CommentKeys {
  propertyId: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  editedAt: string;
}
// The single owner of what a valid Comment is; only the key naming differs between the
// PostgREST database row (snake_case) and the application wire shape (camelCase).
function commentFrom(row: unknown, keys: CommentKeys): Comment | null {
  const value: Record<string, unknown> =
    row && typeof row === 'object' && !Array.isArray(row)
      ? (row as Record<string, unknown>)
      : {};
  const id = value.id,
    propertyId = value[keys.propertyId],
    authorId = value[keys.authorId],
    authorName = value[keys.authorName],
    body = value.body,
    createdAt = value[keys.createdAt],
    revision = value.revision,
    editedAt = value[keys.editedAt];
  if (
    typeof id !== 'string' ||
    !uuidPattern.test(id) ||
    typeof propertyId !== 'string' ||
    !uuidPattern.test(propertyId) ||
    typeof authorId !== 'string' ||
    !uuidPattern.test(authorId) ||
    typeof authorName !== 'string' ||
    typeof body !== 'string' ||
    typeof createdAt !== 'string' ||
    typeof revision !== 'string' ||
    !uuidPattern.test(revision) ||
    (editedAt !== null && typeof editedAt !== 'string')
  )
    return null;
  return {
    id,
    propertyId,
    authorId,
    authorName,
    body,
    createdAt,
    revision,
    editedAt: editedAt as string | null,
  };
}
// The database-row validator: PostgREST returns snake_case columns.
export function toComment(row: unknown): Comment | null {
  return commentFrom(row, {
    propertyId: 'property_id',
    authorId: 'author_id',
    authorName: 'author_name',
    createdAt: 'created_at',
    editedAt: 'edited_at',
  });
}
// The application wire shape: the JSON API serializes `Comment` with camelCase fields.
export function toWireComment(value: unknown): Comment | null {
  return commentFrom(value, {
    propertyId: 'propertyId',
    authorId: 'authorId',
    authorName: 'authorName',
    createdAt: 'createdAt',
    editedAt: 'editedAt',
  });
}
