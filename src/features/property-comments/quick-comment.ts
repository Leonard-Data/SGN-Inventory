// The quick view's comment composer, in the small: the same comment path, the same length rules
// and the same one-key-per-draft retry the full discussion uses, in a flow the drawer can run
// without carrying the discussion's editing and moderation state. The transport is injected, so
// what the composer sends — and what it sends again after an ambiguous failure — is testable
// without a network or a browser.
import { COMMENT_MAX_LENGTH } from './types.ts';

export type QuickComment = {
  id: string;
  authorName: string;
  body: string | null;
  createdAt: string;
  removedAt: string | null;
};

export type QuickCommentOutcome =
  | { ok: true; comment: QuickComment }
  | {
      ok: false;
      // The application's own refusal code, or `unavailable` when the failure carried none.
      code: string;
      // The HTTP status when the failure had one, so the caller can clear a protected surface on
      // a lost session instead of showing it as a comment problem.
      status: number | null;
    };

export type QuickCommentTransport = {
  post: (body: string, key: string) => Promise<QuickComment>;
};

// What the composer can refuse before any request: an empty comment and a comment longer than the
// path accepts. The codes are the application's own refusal vocabulary.
export function quickCommentRefusal(value: string): string | null {
  const length = [...value.trim()].length;
  if (length < 1) return 'comment-required';
  if (length > COMMENT_MAX_LENGTH) return 'comment-too-long';
  return null;
}

export function quickComment({
  transport,
  uuid = () => crypto.randomUUID(),
}: {
  transport: QuickCommentTransport;
  uuid?: () => string;
}) {
  // One submission key per draft: a retry after an ambiguous failure replays the same key, so the
  // path converges on one comment; a conflict proves the key can never succeed and retires it.
  let key = '';
  return {
    refusal: quickCommentRefusal,
    async submit(value: string): Promise<QuickCommentOutcome> {
      const refusal = quickCommentRefusal(value);
      if (refusal) return { ok: false, code: refusal, status: null };
      key ||= uuid();
      try {
        const comment = await transport.post(value.trim(), key);
        key = '';
        return { ok: true, comment };
      } catch (failure) {
        const code = failureCode(failure);
        if (code === 'comment-conflict') key = '';
        return { ok: false, code, status: failureStatus(failure) };
      }
    },
  };
}

function failureCode(failure: unknown): string {
  const code = (failure as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code !== '' ? code : 'unavailable';
}

function failureStatus(failure: unknown): number | null {
  const status = (failure as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}
