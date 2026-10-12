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
import { mergeComments } from './merge';
import {
  toWireComment,
  type Comment,
  type CommentCursor,
  type CommentPage,
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
export function Discussion({
  propertyId,
  locale,
  archived,
  employeeId,
  onDenied,
}: {
  propertyId: string;
  locale: Locale;
  archived: boolean;
  employeeId: string | null;
  onDenied: (status: number) => void;
}) {
  const text = messages[locale],
    headingId = useId(),
    fieldId = useId(),
    helpId = useId(),
    editBaseId = useId();
  const [comments, setComments] = useState<Comment[]>([]);
  const [next, setNext] = useState<CommentCursor | null>(null);
  const [busy, setBusy] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // One author edit at a time: the open draft survives a stale conflict for reconciliation.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editCurrent, setEditCurrent] = useState<Comment | null>(null);
  const [editNotice, setEditNotice] = useState<string | null>(null);
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
  const load = useCallback(
    async (keepLoadedRows: boolean) => {
      const version = ++generation.current;
      const page = await fetchPage(null).catch((problem: unknown) => {
        if (version === generation.current) failure(problem);
        return null;
      });
      if (version === generation.current && page) {
        setComments((rows) =>
          keepLoadedRows ? mergeComments(page.comments, rows) : page.comments,
        );
        setNext(page.nextCursor);
        setError(null);
      }
      // Released unconditionally: a superseding request owns the list, not the spinner.
      setBusy(false);
    },
    [failure, fetchPage],
  );
  const stop = useCallback(() => {
    generation.current++;
    inFlight.current?.abort();
  }, []);
  useEffect(() => {
    void load(false);
    return stop;
  }, [load, stop]);
  function refresh() {
    setBusy(true);
    setEditNotice(null);
    void load(false);
  }
  // Only the stale-edit conflict keeps rows the server's first page does not carry, so the
  // edited row stays on screen alongside the current comment from the 409 payload.
  function reconcile() {
    setBusy(true);
    setEditNotice(null);
    void load(true);
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
  const editMessage =
    editError === 'required'
      ? text.commentRequired
      : editError === 'too-long'
        ? text.commentTooLong
        : editError === 'stale-edit'
          ? text.commentEditStale
          : editError === 'failed'
            ? text.commentEditFailed
            : null;
  function beginEdit(row: Comment) {
    setEditingId(row.id);
    setEditDraft(row.body);
    setEditError(null);
    setEditCurrent(null);
    setEditNotice(null);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditDraft('');
    setEditError(null);
    setEditCurrent(null);
  }
  async function saveEdit(row: Comment) {
    const value = editDraft.trim();
    const length = [...value].length;
    if (length < 1) {
      setEditError('required');
      return;
    }
    if (length > COMMENT_MAX_LENGTH) {
      setEditError('too-long');
      return;
    }
    setSaving(true);
    setEditError(null);
    let updated: Comment;
    try {
      updated = (
        await api<{ comment: Comment }>(
          '/api/properties/' + propertyId + '/comments/' + row.id,
          { body: value, revision: row.revision },
        )
      ).comment;
    } catch (problem) {
      // A 403 covers an archived Property, a changed author and an inactive employee, and the
      // routine raises one code for all of them, so an edit refusal is a save failure that keeps
      // the draft; only a 401 clears the session. A dedicated state-change code is a later
      // slice's contract, not this ticket's.
      if (problem instanceof RequestError && problem.status === 401) {
        onDenied(problem.status);
        return;
      }
      setSaving(false);
      if (problem instanceof RequestError && problem.code === 'stale-edit') {
        // The conflict response carries the row's current text and revision, so reconciliation
        // works for a comment outside the refreshed first page and the retry adopts the newer
        // revision instead of conflicting again.
        const current = toWireComment(problem.payload.comment);
        if (current) {
          setEditCurrent(current);
          setComments((rows) =>
            rows.map((entry) => (entry.id === current.id ? current : entry)),
          );
        }
        // The draft stays in the open editor; the current saved text is shown for reconciliation
        // instead of silently overwriting the newer edit.
        setEditError('stale-edit');
        reconcile();
        return;
      }
      setEditError('failed');
      return;
    }
    setSaving(false);
    setEditingId(null);
    setEditDraft('');
    setEditCurrent(null);
    setEditNotice(text.commentEdited);
    setComments((rows) =>
      rows.map((entry) => (entry.id === updated.id ? updated : entry)),
    );
  }
  return (
    <section className="panel" aria-labelledby={headingId}>
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
                    <span className="field-hint">
                      {`(${text.vietnamTime}${row.editedAt ? ` · ${text.commentEditedMark}` : ''})`}
                    </span>
                  </p>
                  {editingId === row.id ? (
                    <form
                      className="composer"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveEdit(row);
                      }}
                    >
                      <div className="field">
                        <label
                          className="field-label"
                          htmlFor={`${editBaseId}-${row.id}`}
                        >
                          {text.editComment}
                        </label>
                        <textarea
                          id={`${editBaseId}-${row.id}`}
                          className="textarea"
                          name="comment-edit"
                          rows={4}
                          maxLength={COMMENT_MAX_LENGTH}
                          value={editDraft}
                          onChange={(event) => setEditDraft(event.target.value)}
                          aria-describedby={`${editBaseId}-${row.id}-help`}
                          disabled={saving}
                        />
                      </div>
                      <p
                        className="field-hint"
                        id={`${editBaseId}-${row.id}-help`}
                      >
                        {text.commentHint}{' '}
                        <span translate="no">
                          {[...editDraft.trim()].length}/{COMMENT_MAX_LENGTH}
                        </span>
                      </p>
                      {editMessage ? <p role="alert">{editMessage}</p> : null}
                      {editError === 'stale-edit' ? (
                        <>
                          <p className="field-hint">
                            {text.commentEditCurrent}
                          </p>
                          <p className="comment-body" translate="no">
                            {editCurrent?.body ?? row.body}
                          </p>
                        </>
                      ) : null}
                      <div className="composer-foot">
                        <button
                          type="submit"
                          className="btn btn-primary btn-sm"
                          disabled={saving}
                        >
                          {saving ? text.saving : text.saveComment}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={cancelEdit}
                          disabled={saving}
                        >
                          {text.cancel}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="comment-body" translate="no">
                        {row.body}
                      </p>
                      {employeeId === row.authorId && !archived ? (
                        <div className="comment-actions">
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => beginEdit(row)}
                            disabled={editingId !== null}
                          >
                            {text.editComment}
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </article>
            </li>
          );
        })}
      </ol>
      {editNotice ? <p role="status">{editNotice}</p> : null}
      {!busy && !error && !comments.length ? <p>{text.noComments}</p> : null}
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
