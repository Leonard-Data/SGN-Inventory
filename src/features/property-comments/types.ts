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
}
export type CommentCursor = {
  before: string;
  beforeId: string;
};
export interface CommentPage {
  comments: Comment[];
  nextCursor: CommentCursor | null;
}
