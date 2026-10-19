'use client';
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { api, RequestError } from '@/features/employees/api';
import { messages, label, type Locale } from '@/i18n/messages';
import { useToast } from '@/features/toasts/toast-host';
import {
  quickComment,
  type QuickComment,
} from '@/features/property-comments/quick-comment';
import {
  COMMENT_MAX_LENGTH,
  type CommentPage,
} from '@/features/property-comments/types';
import { fileMessages } from '@/features/property-files/messages';
import {
  quickUpload,
  type QuickUploadProgress,
  type QuickUploadTransport,
} from '@/features/property-files/quick-upload';
import type {
  FileRecoveryList,
  FileRegistrationResult,
} from '@/features/property-files/types';
import { DetailActionDialog } from './detail-dialog';
import {
  formatDecimal,
  formatVnd,
  vietnamDate,
  vietnamTimestamp,
} from './format';
import { wholeVnd, squareMetres } from './filters';
import { detailMessages } from './messages';
import { statusTone } from './property-card';
import { MISSING_VALUE, rowPrice, totalAreaM2 } from './table';
import type { PropertySummary } from './types';

// How many of the most recent comments the quick view repeats; the full record holds the rest.
const RECENT_COMMENTS = 5;

type UploadRow = {
  id: string;
  name: string;
  state: QuickUploadProgress | 'failed';
  code?: string;
};

// The record's quick view: the facts a person needs to recognise it, a comment they can post
// without leaving the list, one quick attachment, and the way into the full record. It is a modal
// drawer, so Escape and the focus trap come from the platform; the control that opened it gets
// focus back when it closes.
export function PropertyDrawer({
  property,
  locale,
  open,
  resultLocation,
  showEntry,
  opener,
  onClose,
  onDenied,
}: {
  property: PropertySummary | null;
  locale: Locale;
  open: boolean;
  resultLocation: string;
  showEntry: boolean;
  opener: HTMLElement | null;
  onClose: () => void;
  onDenied: (status: number) => void;
}) {
  const text = messages[locale];
  return (
    <DetailActionDialog
      size="drawer"
      title={text.quickView}
      closeLabel={text.close}
      open={open && property !== null}
      onClose={onClose}
      onClosed={() => {
        // Focus belongs on the row that opened the panel — unless that row is gone, in which case
        // moving focus to another row would be a lie.
        if (opener?.isConnected) opener.focus();
      }}
    >
      {property ? (
        <QuickView
          property={property}
          locale={locale}
          resultLocation={resultLocation}
          showEntry={showEntry}
          onDenied={onDenied}
        />
      ) : null}
    </DetailActionDialog>
  );
}

function QuickView({
  property,
  locale,
  resultLocation,
  showEntry,
  onDenied,
}: {
  property: PropertySummary;
  locale: Locale;
  resultLocation: string;
  showEntry: boolean;
  onDenied: (status: number) => void;
}) {
  const text = messages[locale];
  const fileText = fileMessages[locale];
  const factsText = detailMessages[locale];
  const notify = useToast();
  const factsId = useId();
  const uploadId = useId();
  const draftId = useId();
  const hintId = useId();
  // null while the newest comments are still being read; an empty list is a real answer.
  const [comments, setComments] = useState<QuickComment[] | null>(null);
  const [commentsFailed, setCommentsFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const propertyId = property.id;

  useEffect(() => {
    const abort = new AbortController();
    void api<CommentPage>(
      `/api/properties/${propertyId}/comments`,
      undefined,
      abort.signal,
    )
      .then((page) => {
        if (abort.signal.aborted) return;
        setComments(page.comments);
        setCommentsFailed(false);
      })
      .catch((failure) => {
        if (abort.signal.aborted) return;
        if (denied(failure)) onDenied(failure.status);
        else setCommentsFailed(true);
      });
    return () => abort.abort();
  }, [propertyId, onDenied]);

  // The comment path the whole application uses, reached with one submission key per draft: a
  // retry after an ambiguous failure replays the same key instead of posting twice.
  const composer = useMemo(
    () =>
      quickComment({
        transport: {
          post: (body, key) =>
            api<{ comment: QuickComment }>(
              `/api/properties/${propertyId}/comments`,
              { body, key },
            ).then((result) => result.comment),
        },
      }),
    [propertyId],
  );
  const transport = useMemo<QuickUploadTransport>(
    () => ({
      register: (registration) =>
        api<FileRegistrationResult>(
          `/api/properties/${propertyId}/files/register`,
          registration,
        ),
      put: async (url, file, mimeType) => {
        // Straight to private storage under the short-lived signed PUT: no app-server bytes, and
        // the conditional create means an existing object is never overwritten.
        await fetch(url, {
          method: 'PUT',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': mimeType, 'If-None-Match': '*' },
          body: file,
        });
      },
      recovery: (fileId) =>
        api<FileRecoveryList>(
          `/api/properties/${propertyId}/files/recovery?fileId=${fileId}`,
        ),
      complete: (fileId) =>
        api(`/api/properties/${propertyId}/files/${fileId}/complete`, {}),
    }),
    [propertyId],
  );

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const refusal = composer.refusal(draft);
    if (refusal) {
      setPostError(refusal);
      return;
    }
    setPosting(true);
    setPostError(null);
    const outcome = await composer.submit(draft);
    if (!outcome.ok) {
      setPosting(false);
      if (outcome.status === 401 || outcome.status === 403) {
        onDenied(outcome.status);
        return;
      }
      setPostError(outcome.code);
      return;
    }
    // The accepted comment is in the list without a reload; the draft and its key are spent.
    const created = outcome.comment;
    setComments((rows) => [
      created,
      ...(rows ?? []).filter((row) => row.id !== created.id),
    ]);
    setCommentsFailed(false);
    setDraft('');
    setPosting(false);
    notify({ saved: true, message: text.commentPosted });
  }

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    // The control is cleared straight away, so choosing the same file again is its own selection.
    event.target.value = '';
    if (!file || uploading) return;
    const id = crypto.randomUUID();
    setUploads((rows) => [
      { id, name: file.name, state: 'registering' },
      ...rows,
    ]);
    setUploading(true);
    const outcome = await quickUpload({
      file,
      transport,
      onProgress: (progress) =>
        setUploads((rows) =>
          rows.map((row) =>
            row.id === id ? { ...row, state: progress } : row,
          ),
        ),
    });
    setUploading(false);
    if (!outcome.ok) {
      if (outcome.status === 401 || outcome.status === 403) {
        onDenied(outcome.status);
        return;
      }
      setUploads((rows) =>
        rows.map((row) =>
          row.id === id ? { ...row, state: 'failed', code: outcome.code } : row,
        ),
      );
      return;
    }
    notify({ saved: true, message: `${fileText.ready} · ${file.name}` });
  }

  function postMessage(code: string): string {
    if (code === 'comment-required') return text.commentRequired;
    if (code === 'comment-too-long') return text.commentTooLong;
    if (code === 'comment-conflict') return text.commentConflict;
    return text.commentPostFailed;
  }
  function uploadMessage(code: string | undefined): string {
    return (code && fileText.errors[code]) || text.unavailable;
  }
  // The upload reports its finished state as 'done'; the file message catalogue names that state
  // 'ready'. Every other progress word is the catalogue's own.
  function progressMessage(
    state: QuickUploadProgress,
  ): 'registering' | 'uploading' | 'validating' | 'ready' {
    return state === 'done' ? 'ready' : state;
  }

  const address = property.addresses[0] ?? null;
  const price = rowPrice(property);
  const area = totalAreaM2(property);
  const entryDate = property.entryOn ? vietnamDate(property.entryOn) : null;
  const created = vietnamDate(property.createdAt);
  const updated = vietnamTimestamp(property.updatedAt, locale);
  const vnd = (value: string) =>
    wholeVnd(value) ? formatVnd(value, locale) : value;
  const m2 = (value: string) =>
    squareMetres(value) ? `${formatDecimal(value, locale)} m²` : value;
  // A recorded value the record does not have states the missing-value marker rather than a blank
  // that would read as a zero, exactly as the table's own cells do.
  const recorded = (value: string | null): { value: string; known: boolean } =>
    value !== null
      ? { value, known: true }
      : { value: MISSING_VALUE, known: false };
  const facts: { label: string; value: string; known: boolean }[] = [
    {
      label: text.listingMode,
      value: label(locale, property.listingMode),
      known: Boolean(property.listingMode),
    },
    {
      label: text.propertyType,
      value: label(locale, property.propertyType),
      known: Boolean(property.propertyType),
    },
    { label: text.status, value: label(locale, property.status), known: true },
    {
      label: text.salePrice,
      ...recorded(property.salePriceVnd ? vnd(property.salePriceVnd) : null),
    },
    {
      label: text.monthlyRent,
      ...recorded(
        property.monthlyRentVnd ? vnd(property.monthlyRentVnd) : null,
      ),
    },
    { label: text.columnTotalArea, ...recorded(area ? m2(area) : null) },
    {
      label: text.landArea,
      ...recorded(property.landAreaM2 ? m2(property.landAreaM2) : null),
    },
    {
      label: text.floorArea,
      ...recorded(property.floorAreaM2 ? m2(property.floorAreaM2) : null),
    },
    { label: text.columnCreatedDate, ...recorded(created) },
    { label: text.updated, ...recorded(updated) },
  ];
  if (property.createdBy)
    facts.push({
      label: text.createdBy,
      value: property.createdBy,
      known: true,
    });
  if (showEntry)
    facts.push({
      label: text.entryDate,
      value: entryDate ?? text.entryDateUnknown,
      known: entryDate !== null,
    });
  return (
    <div className="quick-view">
      <div className="quick-view-head">
        <p className="card-meta">{property.propertyCode}</p>
        <p className="quick-view-address" translate="no">
          {address?.addressText || label(locale, null)}
        </p>
        <p className="quick-view-line">
          <span className="badge" data-tone={statusTone(property.status)}>
            {label(locale, property.status)}
          </span>
          {price ? (
            <b className="num">
              {vnd(price.value)}
              <small className="inventory-note">
                {price.unit === 'monthly'
                  ? text.priceUnitMonthly
                  : text.priceUnitVnd}
              </small>
            </b>
          ) : null}
        </p>
      </div>
      <section className="quick-view-section" aria-labelledby={factsId}>
        <h3 id={factsId}>{factsText.facts}</h3>
        <dl className="facts">
          {facts.map((entry, index) => (
            <div className="fact" key={`${entry.label}-${index}`}>
              <dt>{entry.label}</dt>
              <dd className={entry.known ? undefined : 'is-unknown'}>
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="quick-view-section">
        <h3>{text.quickUpload}</h3>
        <div className="field">
          <label className="field-label" htmlFor={uploadId}>
            {fileText.selectFiles}
          </label>
          <input
            className="input"
            id={uploadId}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(event) => void selectFile(event)}
            disabled={uploading}
          />
        </div>
        <p className="field-hint">{fileText.uploadNote}</p>
        {uploads.length ? (
          <ul className="quick-view-uploads">
            {uploads.map((row) => (
              <li key={row.id}>
                <span translate="no">{row.name}</span>{' '}
                <span className="field-hint">
                  {row.state === 'failed'
                    ? uploadMessage(row.code)
                    : fileText[progressMessage(row.state)]}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className="quick-view-section">
        <h3>{text.recentPosts}</h3>
        {commentsFailed ? (
          <p className="field-hint" role="alert">
            {text.unavailable}
          </p>
        ) : comments === null ? (
          <p className="field-hint">{text.loading}</p>
        ) : comments.length ? (
          <ol className="quick-view-comments">
            {comments.slice(0, RECENT_COMMENTS).map((comment) => (
              <li key={comment.id}>
                <p className="comment-author" translate="no">
                  {comment.authorName}
                </p>
                <p className="comment-meta">
                  <time dateTime={comment.createdAt}>
                    {vietnamTimestamp(comment.createdAt, locale)}
                  </time>
                </p>
                <p
                  className={`comment-body${comment.removedAt !== null ? ' comment-removed' : ''}`}
                  translate={comment.removedAt !== null ? undefined : 'no'}
                >
                  {comment.removedAt !== null
                    ? text.commentRemoved
                    : comment.body}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="field-hint">{text.noComments}</p>
        )}
        <form
          className="quick-view-composer"
          onSubmit={(event) => void submitComment(event)}
        >
          <div className="field">
            <label className="field-label" htmlFor={draftId}>
              {text.addComment}
            </label>
            <textarea
              className="textarea"
              id={draftId}
              rows={3}
              maxLength={COMMENT_MAX_LENGTH}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-describedby={hintId}
              disabled={posting}
            />
          </div>
          <p className="field-hint" id={hintId}>
            {text.commentHint}{' '}
            <span className="num">
              {[...draft.trim()].length}/{COMMENT_MAX_LENGTH}
            </span>
          </p>
          {postError ? (
            <p className="field-error" role="alert">
              {postMessage(postError)}
            </p>
          ) : null}
          <div className="composer-foot">
            <button
              className="btn btn-primary btn-sm"
              type="submit"
              disabled={posting}
            >
              {posting ? text.posting : text.postComment}
            </button>
          </div>
        </form>
      </section>
      <div className="quick-view-actions">
        <Link
          className="btn btn-secondary"
          href={
            '/properties/' +
            property.id +
            '?' +
            new URLSearchParams({ returnTo: resultLocation })
          }
        >
          {text.fullRecord}
        </Link>
      </div>
    </div>
  );
}

function denied(failure: unknown): failure is RequestError {
  return (
    failure instanceof RequestError &&
    (failure.status === 401 || failure.status === 403)
  );
}
