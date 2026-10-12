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
import { COMMENT_MAX_LENGTH, COMMENT_PAGE_SIZE } from './types';
import type { Comment, CommentCursor, CommentPage } from './types';

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
export function Discussion({
  propertyId,
  locale,
  archived,
  onDenied,
}: {
  propertyId: string;
  locale: Locale;
  archived: boolean;
  onDenied: (status: number) => void;
}) {
  const text = messages[locale],
    headingId = useId(),
    fieldId = useId(),
    helpId = useId();
  const [comments, setComments] = useState<Comment[]>([]);
  const [next, setNext] = useState<CommentCursor | null>(null);
  const [busy, setBusy] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
      setComments(page.comments);
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
      const seen = new Set(comments.map((row) => row.id));
      setComments([
        ...comments,
        ...page.comments.filter((row) => !seen.has(row.id)),
      ]);
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
      setComments(merged.rows);
      setNext(merged.next);
      setError(null);
    } catch {
      if (version !== generation.current) return;
      const merged = withPost(created, comments, !!next);
      setComments(merged.rows);
      setNext(merged.next);
    }
  }
  const loadingMore = busy || more;
  return (
    <section className="panel discussion" aria-labelledby={headingId}>
      <div className="discussion-head">
        <h2 id={headingId}>{text.discussion}</h2>
        <button type="button" onClick={refresh} disabled={loadingMore}>
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
          <button type="button" onClick={refresh}>
            {text.retry}
          </button>
        </p>
      ) : null}
      <ol className="comment-list">
        {comments.map((row) => (
          <li key={row.id}>
            <article className="comment">
              <p className="comment-meta">
                <span translate="no">{row.authorName}</span> ·{' '}
                <time dateTime={row.createdAt}>
                  {vietnamTimestamp(row.createdAt, locale)}
                </time>{' '}
                <span className="muted">({text.vietnamTime})</span>
              </p>
              <p className="comment-body" translate="no">
                {row.body}
              </p>
            </article>
          </li>
        ))}
      </ol>
      {!busy && !error && !comments.length ? <p>{text.noComments}</p> : null}
      {next ? (
        <p>
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {more ? text.loading : text.moreComments}
          </button>
        </p>
      ) : null}
      {archived ? null : (
        <form className="comment-form" onSubmit={submit}>
          <label htmlFor={fieldId}>{text.addComment}</label>
          <textarea
            id={fieldId}
            name="comment"
            rows={4}
            maxLength={COMMENT_MAX_LENGTH}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-describedby={helpId}
            disabled={posting}
          />
          <p className="muted" id={helpId}>
            {text.commentHint}{' '}
            <span translate="no">
              {[...draft.trim()].length}/{COMMENT_MAX_LENGTH}
            </span>
          </p>
          {postError ? (
            <p role="alert">
              {postError}{' '}
              <button type="button" onClick={refresh}>
                {text.refresh}
              </button>
            </p>
          ) : null}
          {notice ? <p role="status">{notice}</p> : null}
          <button type="submit" disabled={posting}>
            {posting ? text.posting : text.postComment}
          </button>
        </form>
      )}
    </section>
  );
}
