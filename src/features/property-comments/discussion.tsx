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
import { COMMENT_MAX_LENGTH, COMMENT_REASON_MAX_LENGTH } from './types';
import {
  mergePage,
  mergeStaleEditState,
  retainEditTarget,
  withPost,
} from './discussion-state';
import type {
  Comment,
  CommentCursor,
  CommentPage,
  CommentRemovalKind,
} from './types';

type EditSession = {
  id: string;
  expectedRevision: string;
  key: string;
};

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
    editId = useId(),
    editHintId = useId(),
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
  // Author editing: the open editor, its unsent draft, the kept failure state and its notice.
  const [editing, setEditing] = useState<EditSession | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editAction, setEditAction] = useState<{
    id: string;
    code: string;
  } | null>(null);
  const [editReconciled, setEditReconciled] = useState(false);
  const [editNotice, setEditNotice] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const editTarget = useRef<string | null>(null);
  // The open editor's identity; a save response only closes the editor it was sent from.
  const editSession = useRef<EditSession | null>(null);
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
  const fetchComment = useCallback(
    (commentId: string) =>
      api<{ comment: Comment }>(
        '/api/properties/' + propertyId + '/comments/' + commentId,
      ),
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
    const target = editTarget.current;
    try {
      const [pageResult, currentResult] = await Promise.allSettled([
        fetchPage(null),
        target
          ? fetchComment(target)
              .then(({ comment }) => comment)
              .catch((problem: unknown) => {
                if (
                  problem instanceof RequestError &&
                  (problem.status === 401 || problem.status === 403)
                )
                  throw problem;
                return null;
              })
          : Promise.resolve(null),
      ]);
      if (version !== generation.current) return 'superseded';
      const denied = [pageResult, currentResult].find(
        (result) =>
          result.status === 'rejected' &&
          result.reason instanceof RequestError &&
          (result.reason.status === 401 || result.reason.status === 403),
      );
      if (denied?.status === 'rejected') throw denied.reason;
      if (pageResult.status === 'rejected') throw pageResult.reason;
      const page = pageResult.value;
      const current =
        currentResult.status === 'fulfilled' ? currentResult.value : null;
      const activeTarget = editTarget.current;
      const exact = activeTarget === target ? current : null;
      setComments((rows) =>
        activeTarget
          ? mergeStaleEditState(rows, page.comments, exact)
          : mergePage(rows, page.comments),
      );
      setNext(page.nextCursor);
      setError(null);
      if (activeTarget)
        setEditReconciled(
          exact !== null ||
            page.comments.some((row) => row.id === activeTarget),
        );
      return 'loaded';
    } catch (problem) {
      if (version !== generation.current) return 'superseded';
      failure(problem);
      return problem instanceof RequestError &&
        (problem.status === 401 || problem.status === 403)
        ? 'denied'
        : 'failed';
    } finally {
      // Released unconditionally: a superseding request owns the list, not the spinner.
      setBusy(false);
    }
  }, [failure, fetchComment, fetchPage]);
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
      setComments((rows) =>
        retainEditTarget(
          withPost(created, mergePage(rows, page.comments), !!page.nextCursor)
            .rows,
          rows,
          editTarget.current,
        ),
      );
      setNext(merged.next);
      setError(null);
    } catch {
      if (version !== generation.current) return;
      const merged = withPost(created, comments, !!next);
      setComments((rows) =>
        retainEditTarget(
          withPost(created, rows, !!next).rows,
          rows,
          editTarget.current,
        ),
      );
      setNext(merged.next);
    }
  }
  // Opening the editor replaces the entry's text with the draft and clears the other actions,
  // so one entry is never being edited, moderated and withdrawn at the same time.
  function beginEdit(row: Comment) {
    const session: EditSession = {
      id: row.id,
      expectedRevision: row.revision,
      key: crypto.randomUUID(),
    };
    editTarget.current = row.id;
    editSession.current = session;
    setEditing(session);
    setEditDraft(row.body ?? '');
    setEditAction(null);
    setEditReconciled(false);
    setEditNotice(null);
    setReasonFor(null);
    setReason('');
    setAction(null);
  }
  function cancelEdit() {
    editTarget.current = null;
    editSession.current = null;
    setEditing(null);
    setEditDraft('');
    setEditAction(null);
    setEditReconciled(false);
  }
  async function saveEdit(row: Comment) {
    const session = editing;
    if (!session || session.id !== row.id) return;
    const value = editDraft.trim();
    const length = [...value].length;
    if (length < 1 || length > COMMENT_MAX_LENGTH) {
      setEditAction({ id: row.id, code: 'invalid-input' });
      return;
    }
    setSavingEdit(true);
    setEditAction(null);
    setEditNotice(null);
    let updated: Comment;
    try {
      updated = (
        await api<{ comment: Comment }>(
          '/api/properties/' + propertyId + '/comments/' + row.id,
          {
            revision: session.expectedRevision,
            body: value,
            key: session.key,
          },
          undefined,
          'PATCH',
        )
      ).comment;
    } catch (problem) {
      if (
        problem instanceof RequestError &&
        (problem.status === 401 || problem.status === 403)
      ) {
        setSavingEdit(false);
        onDenied(problem.status);
        return;
      }
      const code =
        problem instanceof RequestError ? problem.code : 'unavailable';
      if (code === 'stale-comment') {
        setBusy(true);
        const result = await load();
        if (result === 'denied') {
          setSavingEdit(false);
          return;
        }
      }
      // The typed text stays in the editor and no success is claimed; refresh reconciles.
      setEditAction({ id: row.id, code });
      setSavingEdit(false);
      return;
    }
    // The accepted response replaces the entry in place, so the edit never becomes a new post.
    setComments((rows) =>
      rows.map((entry) => (entry.id === updated.id ? updated : entry)),
    );
    // A replayed key can converge on an already-withdrawn comment, so the response is not a save.
    if (updated.removedAt !== null) {
      setBusy(true);
      const result = await load();
      if (result !== 'denied')
        setEditAction({ id: row.id, code: 'stale-comment' });
      setSavingEdit(false);
      return;
    }
    // Only the session that sent this request closes with it; a newer editor keeps its draft.
    if (editSession.current === session) {
      editTarget.current = null;
      editSession.current = null;
      setEditing(null);
      setEditDraft('');
      setEditReconciled(false);
    }
    setEditNotice(text.commentEdited);
    setSavingEdit(false);
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
  const editMessage = (code: string) => {
    if (code === 'comment-unchanged') return text.commentUnchanged;
    if (code === 'invalid-input') return text.commentRequired;
    if (code === 'stale-comment') return text.editStale;
    if (code === 'access-denied' || code === 'unauthenticated')
      return text.editDenied;
    return text.editFailed;
  };
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
          const editingHere = editing?.id === row.id;
          // Author withdrawal and editing are the author's own controls and are blocked on an
          // archived Property; reasoned moderation stays available there for a reviewer.
          const canWithdraw =
            !archived && employeeId !== null && employeeId === row.authorId;
          const canEdit = canWithdraw && !removed;
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
                    {!removed && row.editedAt !== null ? (
                      <>
                        {' '}
                        <span
                          className="comment-edited"
                          title={
                            vietnamTimestamp(row.editedAt, locale) ?? undefined
                          }
                        >
                          ({text.commentEditedMarker})
                        </span>
                      </>
                    ) : null}
                  </p>
                  {removed && !editingHere ? (
                    <p className="comment-body comment-removed">
                      {text.commentRemoved}
                    </p>
                  ) : null}
                  {/* An entry removed by another session while its editor was open keeps both the
                      marker and the unsent draft, so the edit is never silently lost. */}
                  {editingHere ? (
                    <form
                      className="comment-edit"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveEdit(row);
                      }}
                    >
                      {editReconciled ? (
                        <div className="field comment-current">
                          <p className="field-label">{text.commentCurrent}</p>
                          <p
                            className={`comment-body${removed ? ' comment-removed' : ''}`}
                            translate={removed ? undefined : 'no'}
                          >
                            {removed ? text.commentRemoved : row.body}
                          </p>
                        </div>
                      ) : null}
                      <div className="field">
                        <label
                          className="field-label"
                          htmlFor={`${editId}-${row.id}`}
                        >
                          {text.editComment}
                        </label>
                        <textarea
                          id={`${editId}-${row.id}`}
                          className="textarea"
                          rows={4}
                          maxLength={COMMENT_MAX_LENGTH}
                          value={editDraft}
                          onChange={(event) => setEditDraft(event.target.value)}
                          aria-describedby={`${editHintId}-${row.id}`}
                          disabled={savingEdit}
                          autoFocus
                        />
                      </div>
                      <p className="field-hint" id={`${editHintId}-${row.id}`}>
                        {text.editHint}{' '}
                        <span translate="no">
                          {[...editDraft.trim()].length}/{COMMENT_MAX_LENGTH}
                        </span>
                      </p>
                      {editAction?.id === row.id ? (
                        <p role="alert" className="field-error">
                          {editMessage(editAction.code)}{' '}
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={refresh}
                          >
                            {text.refresh}
                          </button>
                        </p>
                      ) : null}
                      <div className="composer-foot">
                        <button
                          type="submit"
                          className="btn btn-primary btn-sm"
                          disabled={savingEdit}
                        >
                          {savingEdit ? text.savingComment : text.saveComment}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={cancelEdit}
                          disabled={savingEdit}
                        >
                          {text.cancel}
                        </button>
                      </div>
                    </form>
                  ) : removed ? null : (
                    <p className="comment-body" translate="no">
                      {row.body}
                    </p>
                  )}
                  {!removed && !editingHere && (canWithdraw || reviewer) ? (
                    <div className="comment-actions">
                      {canEdit ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => beginEdit(row)}
                          disabled={savingEdit || removing === row.id}
                        >
                          {text.editComment}
                        </button>
                      ) : null}
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
      {editNotice ? <p role="status">{editNotice}</p> : null}
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
