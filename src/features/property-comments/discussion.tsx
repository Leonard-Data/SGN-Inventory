'use client';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { api, RequestError } from '@/features/employees/api';
import { vietnamTimestamp } from '@/features/properties/format';
import {
  COMMENT_MAX_LENGTH,
  COMMENT_PAGE_SIZE,
  COMMENT_REASON_MAX_LENGTH,
} from './types';
import type {
  Comment,
  CommentCursor,
  CommentPage,
  CommentRemovalKind,
} from './types';

const cursorOf = (row: Comment | undefined): CommentCursor | null =>
  row ? { before: row.createdAt, beforeId: row.id } : null;
// Keep the caller's confirmed post visible without disturbing the server's newest-first page.
function withPost(created: Comment, page: Comment[], more: boolean) {
  const rows = [created, ...page.filter((row) => row.id !== created.id)].slice(
    0,
    COMMENT_PAGE_SIZE,
  );
  return { rows, next: more ? cursorOf(rows.at(-1)) : null };
}
// A removal is terminal, so a response that predates it must never restore withdrawn text.
function mergePage(current: Comment[], page: Comment[]): Comment[] {
  const local = new Map(current.map((row) => [row.id, row]));
  return page.map((row) => {
    const existing = local.get(row.id);
    return existing && existing.removedAt !== null && row.removedAt === null
      ? existing
      : row;
  });
}
export function Discussion({
  propertyId,
  locale,
  archived,
  employeeId,
  reviewer,
  onDenied,
}: {
  propertyId: string;
  locale: Locale;
  archived: boolean;
  employeeId: string | null;
  reviewer: boolean;
  onDenied: (status: number) => void;
}) {
  const text = messages[locale],
    headingId = useId(),
    fieldId = useId(),
    helpId = useId(),
    reasonId = useId(),
    reasonHintId = useId();
  const [comments, setComments] = useState<Comment[]>([]);
  const [next, setNext] = useState<CommentCursor | null>(null);
  const [busy, setBusy] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Removal: the withdrawing comment, the open moderation reason and its kept draft.
  const [removing, setRemoving] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [action, setAction] = useState<{ id: string; code: string } | null>(
    null,
  );
  const [removeNotice, setRemoveNotice] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const generation = useRef(0);
  // One submission key per draft: an ambiguous failure retries the original comment, a conflict
  // proves that key can never succeed and retires it.
  const submissionKey = useRef('');
  const fetchPage = useCallback(
    async (cursor: CommentCursor | null) => {
      inFlight.current?.abort();
      const abort = new AbortController();
      inFlight.current = abort;
      const query = cursor ? '?' + new URLSearchParams(cursor) : '';
      return api<CommentPage>(
        '/api/properties/' + propertyId + '/comments' + query,
        undefined,
        abort.signal,
      );
    },
    [propertyId],
  );
  const failure = useCallback(
    (problem: unknown) => {
      if (
        problem instanceof RequestError &&
        (problem.status === 401 || problem.status === 403)
      )
        onDenied(problem.status);
      else if (problem instanceof RequestError && problem.code === 'not-found')
        setError('not-found');
      else if (
        problem instanceof RequestError &&
        problem.code === 'invalid-input'
      )
        setError('invalid-input');
      else setError('unavailable');
    },
    [onDenied],
  );
  // Every state update happens after an await, so mounting or refreshing never cascades a render.
  const load = useCallback(async () => {
    const version = ++generation.current;
    const page = await fetchPage(null).catch((problem: unknown) => {
      if (version === generation.current) failure(problem);
      return null;
    });
    if (version === generation.current && page) {
      setComments((rows) => mergePage(rows, page.comments));
      setNext(page.nextCursor);
      setError(null);
    }
    // Released unconditionally: a superseding request owns the list, not the spinner.
    setBusy(false);
  }, [failure, fetchPage]);
  const stop = useCallback(() => {
    generation.current++;
    inFlight.current?.abort();
  }, []);
  useEffect(() => {
    void load();
    return stop;
  }, [load, stop]);
  function refresh() {
    setBusy(true);
    void load();
  }
  async function loadMore() {
    if (!next) return;
    const version = ++generation.current;
    setMore(true);
    setError(null);
    try {
      const page = await fetchPage(next);
      if (version !== generation.current) return;
      setComments((rows) => {
        const seen = new Set(rows.map((row) => row.id));
        return [
          ...rows,
          ...mergePage(rows, page.comments).filter((row) => !seen.has(row.id)),
        ];
      });
      setNext(page.nextCursor);
    } catch (problem) {
      if (version === generation.current) failure(problem);
    } finally {
      // Released unconditionally so an interrupted load-more can never strand the control.
      setMore(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    const length = [...value].length;
    if (length < 1) {
      setPostError(text.commentRequired);
      return;
    }
    if (length > COMMENT_MAX_LENGTH) {
      setPostError(text.commentTooLong);
      return;
    }
    submissionKey.current ||= crypto.randomUUID();
    setPosting(true);
    setPostError(null);
    setNotice(null);
    let created: Comment;
    try {
      created = (
        await api<{ comment: Comment }>(
          '/api/properties/' + propertyId + '/comments',
          { body: value, key: submissionKey.current },
        )
      ).comment;
    } catch (problem) {
      if (
        problem instanceof RequestError &&
        (problem.status === 401 || problem.status === 403)
      ) {
        onDenied(problem.status);
        return;
      }
      const conflicted =
        problem instanceof RequestError && problem.code === 'comment-conflict';
      if (conflicted) submissionKey.current = '';
      setPostError(conflicted ? text.commentConflict : text.commentPostFailed);
      setPosting(false);
      return;
    }
    // A replayed key can converge on an already-withdrawn comment, so the marker is not a post.
    if (created.removedAt !== null) {
      submissionKey.current = '';
      setNotice(text.commentPostRemoved);
      setPosting(false);
      refresh();
      return;
    }
    // Committed state is authoritative: only now is the draft spent and its key retired.
    submissionKey.current = '';
    setDraft('');
    setNotice(text.commentPosted);
    setPosting(false);
    const version = ++generation.current;
    try {
      const page = await fetchPage(null);
      if (version !== generation.current) return;
      const merged = withPost(created, page.comments, !!page.nextCursor);
      setComments(
        (rows) =>
          withPost(created, mergePage(rows, page.comments), !!page.nextCursor)
            .rows,
      );
      setNext(merged.next);
      setError(null);
    } catch {
      if (version !== generation.current) return;
      const merged = withPost(created, comments, !!next);
      setComments((rows) => withPost(created, rows, !!next).rows);
      setNext(merged.next);
    }
  }
  // Removal replaces the entry in place, so the marker keeps the original posting position.
  async function remove(row: Comment, kind: CommentRemovalKind) {
    if (removing) return;
    const value = kind === 'moderation' ? reason.trim() : '';
    if (kind === 'moderation' && !value) {
      setAction({ id: row.id, code: 'invalid-input' });
      return;
    }
    setRemoving(row.id);
    setAction(null);
    setRemoveNotice(null);
    let removed: Comment;
    try {
      removed = (
        await api<{ comment: Comment }>(
          '/api/properties/' + propertyId + '/comments/' + row.id + '/removal',
          kind === 'moderation'
            ? { revision: row.revision, kind, reason: value }
            : { revision: row.revision, kind },
        )
      ).comment;
    } catch (problem) {
      const code =
        problem instanceof RequestError ? problem.code : 'unavailable';
      // The typed reason is kept and no success is claimed; the alert offers the refresh that
      // reconciles the moved server state.
      setAction({ id: row.id, code });
      setRemoving(null);
      return;
    }
    setComments((rows) =>
      rows.map((entry) => (entry.id === removed.id ? removed : entry)),
    );
    setReason('');
    setReasonFor(null);
    setRemoveNotice(text.commentRemoved);
    setRemoving(null);
  }
  const actionMessage = (code: string) =>
    code === 'invalid-input'
      ? text.removalReasonRequired
      : code === 'stale-comment'
        ? text.removalStale
        : code === 'access-denied' || code === 'unauthenticated'
          ? text.removalDenied
          : text.removalFailed;
  const loadingMore = busy || more;
  return (
    <section className="panel discussion" aria-labelledby={headingId}>
      <div className="panel-head">
        <h2 id={headingId}>{text.discussion}</h2>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={refresh}
          disabled={loadingMore}
        >
          {text.refresh}
        </button>
      </div>
      {busy ? <p role="status">{text.loading}</p> : null}
      {error ? (
        <p role="alert">
          {error === 'not-found'
            ? text.notFound
            : error === 'invalid-input'
              ? text.invalidInput
              : text.unavailable}{' '}
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={refresh}
          >
            {text.retry}
          </button>
        </p>
      ) : null}
      <ol>
        {comments.map((row) => {
          const parts = row.authorName.trim().split(/\s+/);
          const initials = parts
            .slice(-2)
            .map((p) => p.charAt(0))
            .join('')
            .toUpperCase();
          const removed = row.removedAt !== null;
          // Author withdrawal is the author's own control and is blocked on an archived
          // Property; reasoned moderation stays available there for a reviewer.
          const canWithdraw =
            !archived && employeeId !== null && employeeId === row.authorId;
          return (
            <li key={row.id}>
              <article className="comment">
                <span className="sgn-avatar" aria-hidden="true">
                  {initials}
                </span>
                <div>
                  <p className="comment-author" translate="no">
                    {row.authorName}
                  </p>
                  <p className="comment-meta">
                    <time dateTime={row.createdAt}>
                      {vietnamTimestamp(row.createdAt, locale)}
                    </time>{' '}
                    <span className="field-hint">({text.vietnamTime})</span>
                  </p>
                  {removed ? (
                    <p className="comment-body comment-removed">
                      {text.commentRemoved}
                    </p>
                  ) : (
                    <p className="comment-body" translate="no">
                      {row.body}
                    </p>
                  )}
                  {!removed && (canWithdraw || reviewer) ? (
                    <div className="comment-actions">
                      {canWithdraw ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => void remove(row, 'author')}
                          disabled={removing === row.id}
                        >
                          {text.removeComment}
                        </button>
                      ) : null}
                      {reviewer ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          aria-expanded={reasonFor === row.id}
                          aria-controls={`${reasonId}-${row.id}`}
                          onClick={() => {
                            setReasonFor(reasonFor === row.id ? null : row.id);
                            setReason('');
                            setAction(null);
                          }}
                          disabled={removing === row.id}
                        >
                          {text.moderateComment}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {reasonFor === row.id && !removed ? (
                    <form
                      className="comment-moderation"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void remove(row, 'moderation');
                      }}
                    >
                      <div className="field">
                        <label
                          className="field-label"
                          htmlFor={`${reasonId}-${row.id}`}
                        >
                          {text.removalReason}
                        </label>
                        <textarea
                          id={`${reasonId}-${row.id}`}
                          className="textarea"
                          rows={3}
                          maxLength={COMMENT_REASON_MAX_LENGTH}
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          aria-describedby={reasonHintId}
                          disabled={removing === row.id}
                          autoFocus
                        />
                      </div>
                      <p className="field-hint" id={reasonHintId}>
                        {text.removalReasonHint}{' '}
                        <span translate="no">
                          {[...reason.trim()].length}/
                          {COMMENT_REASON_MAX_LENGTH}
                        </span>
                      </p>
                      <div className="composer-foot">
                        <button
                          type="submit"
                          className="btn btn-danger btn-sm"
                          disabled={removing === row.id}
                        >
                          {removing === row.id
                            ? text.removing
                            : text.confirmRemove}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setReasonFor(null);
                            setReason('');
                            setAction(null);
                          }}
                          disabled={removing === row.id}
                        >
                          {text.cancel}
                        </button>
                      </div>
                    </form>
                  ) : null}
                  {action?.id === row.id ? (
                    <p role="alert" className="field-error">
                      {actionMessage(action.code)}{' '}
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={refresh}
                      >
                        {text.refresh}
                      </button>
                    </p>
                  ) : null}
                </div>
              </article>
            </li>
          );
        })}
      </ol>
      {!busy && !error && !comments.length ? <p>{text.noComments}</p> : null}
      {removeNotice ? <p role="status">{removeNotice}</p> : null}
      {next ? (
        <p>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {more ? text.loading : text.moreComments}
          </button>
        </p>
      ) : null}
      {archived ? null : (
        <form className="composer" onSubmit={submit}>
          <div className="field">
            <label className="field-label" htmlFor={fieldId}>
              {text.addComment}
            </label>
            <textarea
              id={fieldId}
              className="textarea"
              name="comment"
              rows={4}
              maxLength={COMMENT_MAX_LENGTH}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-describedby={helpId}
              disabled={posting}
            />
          </div>
          <p className="field-hint" id={helpId}>
            {text.commentHint}{' '}
            <span translate="no">
              {[...draft.trim()].length}/{COMMENT_MAX_LENGTH}
            </span>
          </p>
          {postError ? (
            <p role="alert">
              {postError}{' '}
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={refresh}
              >
                {text.refresh}
              </button>
            </p>
          ) : null}
          {notice ? <p role="status">{notice}</p> : null}
          <div className="composer-foot">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={posting}
            >
              {posting ? text.posting : text.postComment}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
