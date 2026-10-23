'use client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { messages as globalMessages, type Locale } from '@/i18n/messages';
import { fileMessages } from './messages';
import { fileClass, sizeRefusal } from './limits';
import { IconAction } from '@/features/icon-action';
import { api, RequestError } from '@/features/employees/api';
import { LoadingSkeleton } from '@/features/skeleton';
import { sessionLost } from './refusals';
import { applyServerSummary } from '@/features/properties/catalogue-changes';
import { useCatalogueChange } from '@/features/properties/catalogue-provider';
import type { PropertySummary } from '@/features/properties/types';
import { CoverImage } from './cover-image';
import type {
  PropertyFileList,
  SignedFileResponse,
  FileRegistrationResult,
  FileRecoveryList,
  RecoverableFile,
  DocumentCategoryList,
} from './types';

type Upload = {
  id: string;
  filename: string;
  state: 'registering' | 'uploading' | 'validating' | 'ready' | 'failed';
  error?: string;
};

const otherCategoryId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

// A record can carry many attachments. The list is bounded to one page at a time so it
// never grows past the panel, and the pager is the only way to reach the rest.
const FILES_PER_PAGE = 5;

export function Workspace({
  propertyId,
  locale,
  employeeId,
  archived,
  onDenied,
  canEdit,
  coverFileId,
  onCoverChanged,
}: {
  propertyId: string;
  locale: Locale;
  employeeId: string | null;
  archived: boolean;
  onDenied: (status: number) => void;
  canEdit: boolean;
  coverFileId: string | null;
  onCoverChanged: () => void;
}) {
  const [files, setFiles] = useState<PropertyFileList['files']>([]);
  // The chosen cover is part of the list's summary, so the confirmed cover refreshes the browser's
  // catalogue row from the server's own answer.
  const applyChange = useCatalogueChange();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [signing, setSigning] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [recoverable, setRecoverable] = useState<RecoverableFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [purpose, setPurpose] = useState<'photo' | 'document'>('document');
  const [categories, setCategories] = useState<
    DocumentCategoryList['categories']
  >([]);
  const [selectedCategoryId, setSelectedCategoryId] =
    useState<string>(otherCategoryId);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [checkingPhoto, setCheckingPhoto] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const text = globalMessages[locale];
  const fileText = fileMessages[locale];
  const fileInputDisabled = uploading || creatingCategory || busy;

  useEffect(() => {
    const version = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    const filesRequest = api<PropertyFileList>(
      `/api/properties/${propertyId}/files`,
      undefined,
      abort.signal,
    );
    void Promise.all([
      filesRequest,
      archived || !employeeId
        ? Promise.resolve<FileRecoveryList>({ uploads: [] })
        : api<FileRecoveryList>(
            `/api/properties/${propertyId}/files/recovery`,
            undefined,
            abort.signal,
          ),
      filesRequest.then(() =>
        api<DocumentCategoryList>(
          '/api/document-categories',
          undefined,
          abort.signal,
        ),
      ),
    ])
      .then(([result, recovery, cats]) => {
        if (generation.current !== version || abort.signal.aborted) return;
        setFiles(result.files);
        setRecoverable(recovery.uploads);
        setCategories(cats.categories);
        setError(null);
      })
      .catch((failure) => {
        if (generation.current !== version || abort.signal.aborted) return;
        setFiles([]);
        setRecoverable([]);
        setCategories([]);
        if (failure instanceof RequestError && sessionLost(failure))
          onDenied(failure.status);
        else
          setError(
            failure instanceof RequestError ? failure.code : 'unavailable',
          );
      })
      .finally(() => {
        if (generation.current === version && !abort.signal.aborted)
          setBusy(false);
      });
    return () => abort.abort();
  }, [propertyId, employeeId, archived, onDenied, revision]);

  function denied(failure: unknown) {
    if (failure instanceof RequestError && sessionLost(failure)) {
      onDenied(failure.status);
      return true;
    }
    return false;
  }

  async function changeCover(fileId: string | null) {
    const version = generation.current;
    const signal = controller.current?.signal;
    setCoverBusy(true);
    setCoverError(null);
    try {
      const result = await api<{ summary?: PropertySummary | null }>(
        `/api/properties/${propertyId}/cover`,
        { fileId },
        signal,
      );
      applyServerSummary(applyChange, result, propertyId);
      if (generation.current === version && !signal?.aborted) onCoverChanged();
    } catch (failure) {
      if (
        generation.current === version &&
        !signal?.aborted &&
        !denied(failure)
      )
        setCoverError(
          failure instanceof RequestError ? failure.code : 'unavailable',
        );
    } finally {
      if (generation.current === version && !signal?.aborted)
        setCoverBusy(false);
    }
  }
  async function checkPhoto(fileId: string) {
    const version = generation.current;
    const signal = controller.current?.signal;
    setCheckingPhoto(fileId);
    setCoverError(null);
    try {
      await api(
        `/api/properties/${propertyId}/files/${fileId}/complete`,
        {},
        signal,
      );
      if (generation.current === version && !signal?.aborted)
        setRevision((value) => value + 1);
    } catch (failure) {
      if (
        generation.current === version &&
        !signal?.aborted &&
        !denied(failure)
      )
        setCoverError(
          failure instanceof RequestError ? failure.code : 'unavailable',
        );
    } finally {
      if (generation.current === version && !signal?.aborted)
        setCheckingPhoto(null);
    }
  }
  async function open(fileId: string, download: boolean) {
    const version = generation.current;
    const signal = controller.current?.signal;
    setSigning(fileId);
    setError(null);
    try {
      const result = await api<SignedFileResponse>(
        `/api/properties/${propertyId}/files/${fileId}/signed`,
        { download },
        signal,
      );
      if (generation.current !== version || signal?.aborted) return;
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (failure) {
      if (generation.current !== version || signal?.aborted) return;
      if (!denied(failure))
        setError(
          failure instanceof RequestError ? failure.code : 'unavailable',
        );
    } finally {
      if (generation.current === version && !signal?.aborted) setSigning(null);
    }
  }

  // The cover slot asks for the record's own photograph: the upload control switches to
  // the Property-photo purpose, which is the only purpose the cover RPC accepts.
  function addCoverImage() {
    setPurpose('photo');
    fileInput.current?.focus();
    fileInput.current?.scrollIntoView({ block: 'center' });
    fileInput.current?.click();
  }

  function categoryName(id: string): string {
    const cat = categories.find((c) => c.id === id);
    if (!cat) return fileText.otherCategory;
    if (cat.builtin === 'other') return fileText.otherCategory;
    if (cat.builtin === 'land_certificate') return fileText.land_certificate;
    if (cat.builtin === 'sale_contract') return fileText.sale_contract;
    if (cat.builtin === 'planning') return fileText.planning;
    if (cat.builtin === 'construction_permit')
      return fileText.construction_permit;
    if (cat.builtin === 'photo') return fileText.photo;
    return cat.name;
  }

  async function upload(file: File | null, recovery?: RecoverableFile) {
    const version = generation.current;
    const signal = controller.current?.signal;
    const id = recovery?.file.id ?? crypto.randomUUID();
    const filename = recovery?.file.original_filename ?? file!.name;
    const categoryId = recovery?.file.category_id ?? selectedCategoryId;
    setUploads((rows) => [
      ...rows.filter((row) => row.id !== id),
      { id, filename, state: 'registering' },
    ]);
    const update = (state: Upload['state'], code?: string) => {
      if (generation.current === version && !signal?.aborted)
        setUploads((rows) =>
          rows.map((row) =>
            row.id === id ? { ...row, state, error: code } : row,
          ),
        );
    };
    try {
      let sha256 = '';
      if (file) {
        if (file.size <= 0) throw new RequestError(400, 'empty-file');
        const kind = fileClass(file.type);
        if (kind) {
          const refusal = sizeRefusal(kind, file.size);
          if (refusal) throw new RequestError(400, refusal);
        }
        const digest = new Uint8Array(
          await crypto.subtle.digest('SHA-256', await file.arrayBuffer()),
        );
        for (const byte of digest) sha256 += byte.toString(16).padStart(2, '0');
      }
      if (recovery) {
        const state = await api<FileRecoveryList>(
          `/api/properties/${propertyId}/files/recovery?fileId=${id}`,
          undefined,
          signal,
        );
        recovery = state.uploads[0];
        if (!recovery) throw new RequestError(404, 'not-found');
        if (
          file &&
          (file.size !== recovery.file.size_bytes ||
            sha256 !== recovery.file.sha256)
        )
          throw new RequestError(400, 'file-mismatch');
        if (
          recovery.file.upload_status === 'ready' &&
          recovery.file.validated_object_id
        ) {
          update('ready');
          return true;
        }
        if (recovery.objectState === 'unknown')
          throw new RequestError(503, 'unknown-object-state');
        if (recovery.objectState === 'unusable')
          throw new RequestError(400, 'replacement-required');
        if (recovery.objectState === 'absent' && !file)
          throw new RequestError(400, 'missing-bytes');
      } else if (
        !file ||
        !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(
          file.type,
        )
      ) {
        throw new RequestError(400, 'unsupported-format');
      }
      if (!recovery || recovery.objectState === 'absent') {
        const registration = await api<FileRegistrationResult>(
          `/api/properties/${propertyId}/files/register`,
          {
            fileId: id,
            originalFilename: filename,
            mimeType: recovery?.file.mime_type ?? file!.type,
            sizeBytes: recovery?.file.size_bytes ?? file!.size,
            sha256: recovery?.file.sha256 ?? sha256,
            purpose: recovery?.file.purpose ?? purpose,
            categoryId,
          },
          signal,
        );
        if (generation.current !== version || signal?.aborted) return false;
        update('uploading');
        if (file!.size !== registration.uploadBytes)
          throw new RequestError(400, 'file-mismatch');
        try {
          // Direct to private R2 under the short-lived signed PUT, whose signature covers the
          // registered byte count and requires the conditional create; no app-server bytes.
          await fetch(registration.uploadUrl, {
            method: 'PUT',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
            signal,
            headers: {
              'Content-Type': recovery?.file.mime_type ?? file!.type,
              'If-None-Match': '*',
            },
            body: file!,
          });
        } catch (failure) {
          if (signal?.aborted) throw failure;
        }
        // Lost transport responses never establish whether an immutable object exists.
        const state = await api<FileRecoveryList>(
          `/api/properties/${propertyId}/files/recovery?fileId=${id}`,
          undefined,
          signal,
        );
        const current = state.uploads[0];
        if (
          current?.file.upload_status === 'ready' &&
          current.file.validated_object_id
        ) {
          update('ready');
          return true;
        }
        if (current?.objectState !== 'present')
          throw new RequestError(
            400,
            current?.error ??
              (current?.objectState === 'absent'
                ? 'missing-bytes'
                : 'unknown-object-state'),
          );
      }
      update('validating');
      try {
        await api(
          `/api/properties/${propertyId}/files/${id}/complete`,
          {},
          signal,
        );
      } catch (failure) {
        if (
          signal?.aborted ||
          (failure instanceof RequestError &&
            [401, 403].includes(failure.status))
        )
          throw failure;
        // Completion may have committed before its response was lost.
        const state = await api<FileRecoveryList>(
          `/api/properties/${propertyId}/files/recovery?fileId=${id}`,
          undefined,
          signal,
        );
        if (
          state.uploads[0]?.file.upload_status !== 'ready' ||
          !state.uploads[0]?.file.validated_object_id
        )
          throw failure;
      }
      update('ready');
    } catch (failure) {
      if (generation.current !== version || signal?.aborted || denied(failure))
        return false;
      update(
        'failed',
        failure instanceof RequestError ? failure.code : 'unavailable',
      );
    }
    return true;
  }

  async function selected(
    event: ChangeEvent<HTMLInputElement>,
    recovery?: RecoverableFile,
  ) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!selectedFiles.length || uploading) return;
    const version = generation.current;
    setUploading(true);
    for (const file of selectedFiles) {
      if (!(await upload(file, recovery))) break;
    }
    if (generation.current === version && !controller.current?.signal.aborted) {
      setUploading(false);
      setRevision((value) => value + 1);
    }
  }

  async function retry(recovery: RecoverableFile) {
    if (uploading) return;
    const version = generation.current;
    setUploading(true);
    await upload(null, recovery);
    if (generation.current === version && !controller.current?.signal.aborted) {
      setUploading(false);
      setRevision((value) => value + 1);
    }
  }

  async function handleCreateCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    const version = generation.current;
    const signal = controller.current?.signal;
    setError(null);
    setCreatingCategory(true);
    try {
      const result = await api<{ id: string }>(
        '/api/document-categories',
        { name },
        signal,
      );
      const fresh = await api<DocumentCategoryList>(
        '/api/document-categories',
        undefined,
        signal,
      );
      if (generation.current !== version || signal?.aborted) return;
      setCategories(fresh.categories);
      setSelectedCategoryId(result.id);
      setShowNewCategory(false);
      setNewCategoryName('');
    } catch (failure) {
      if (
        generation.current === version &&
        !signal?.aborted &&
        !denied(failure)
      )
        setError(
          failure instanceof RequestError ? failure.code : 'unavailable',
        );
    } finally {
      if (generation.current === version) setCreatingCategory(false);
    }
  }

  async function changeCategory(fileId: string) {
    const version = generation.current;
    const signal = controller.current?.signal;
    setCategoryBusy(true);
    setCategoryError(null);
    try {
      await api(
        `/api/properties/${propertyId}/files/${fileId}/category`,
        { categoryId: editingCategoryId },
        signal,
      );
      const fresh = await api<PropertyFileList>(
        `/api/properties/${propertyId}/files`,
        undefined,
        signal,
      );
      const freshCategories = await api<DocumentCategoryList>(
        '/api/document-categories',
        undefined,
        signal,
      );
      if (generation.current !== version || signal?.aborted) return;
      setCategories(freshCategories.categories);
      setFiles(fresh.files);
      setEditingFileId(null);
    } catch (failure) {
      if (
        generation.current === version &&
        !signal?.aborted &&
        !denied(failure)
      )
        setCategoryError(
          failure instanceof RequestError ? failure.code : 'unavailable',
        );
    } finally {
      if (generation.current === version) setCategoryBusy(false);
    }
  }

  const pageCount = Math.max(1, Math.ceil(files.length / FILES_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleFiles = files.slice(
    currentPage * FILES_PER_PAGE,
    currentPage * FILES_PER_PAGE + FILES_PER_PAGE,
  );
  return (
    <section className="panel" aria-label={fileText.files}>
      <div className="panel-head">
        <h2>{fileText.files}</h2>
      </div>
      <div className="panel-body">
        {!archived && employeeId ? (
          <fieldset className="dropzone" disabled={fileInputDisabled}>
            <legend className="sr">{fileText.purpose}</legend>
            <label className="check">
              <input
                type="radio"
                name="file-purpose"
                checked={purpose === 'document'}
                onChange={() => setPurpose('document')}
              />
              {fileText.document}
            </label>
            <label className="check">
              <input
                type="radio"
                name="file-purpose"
                checked={purpose === 'photo'}
                onChange={() => setPurpose('photo')}
              />
              {fileText.photo}
            </label>
            <div className="field">
              <label className="field-label" htmlFor={'category-' + propertyId}>
                {fileText.category}
              </label>
              <select
                id={'category-' + propertyId}
                className="select"
                value={selectedCategoryId}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setShowNewCategory(true);
                  } else {
                    setSelectedCategoryId(e.target.value);
                    setShowNewCategory(false);
                  }
                }}
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {categoryName(cat.id)}
                  </option>
                ))}
                <option value="__new__">{fileText.newCategory}</option>
              </select>
            </div>
            {showNewCategory ? (
              <div className="field">
                <label
                  className="field-label"
                  htmlFor={'new-category-' + propertyId}
                >
                  {fileText.categoryName}
                </label>
                <input
                  id={'new-category-' + propertyId}
                  className="input"
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  disabled={creatingCategory}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleCreateCategory();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={creatingCategory || !newCategoryName.trim()}
                  onClick={() => void handleCreateCategory()}
                >
                  {fileText.createCategory}
                </button>
              </div>
            ) : null}
            <div className="field">
              <label className="field-label" htmlFor={'files-' + propertyId}>
                {fileText.selectFiles}
              </label>
              <input
                id={'files-' + propertyId}
                ref={fileInput}
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png,image/webp"
                aria-describedby={'upload-note-' + propertyId}
                onChange={(event) => void selected(event)}
              />
            </div>
            <p id={'upload-note-' + propertyId} className="field-hint">
              {fileText.uploadNote}
            </p>
          </fieldset>
        ) : null}
        {uploads.length ? (
          <ul aria-live="polite">
            {uploads.map((upload) => (
              <li key={upload.id}>
                <span translate="no">{upload.filename}</span>
                {' — '}
                {fileText[upload.state]}
                {upload.error ? (
                  <p role="alert">
                    {fileText.errors[upload.error] ?? text.unavailable}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {!archived && recoverable.length ? (
          <section aria-label={fileText.recovery}>
            <h3>{fileText.recovery}</h3>
            <p>{fileText.recoveryNote}</p>
            <ul>
              {recoverable.map((attempt) => (
                <li key={attempt.file.id}>
                  <span translate="no">{attempt.file.original_filename}</span>
                  <p>{fileText[attempt.objectState]}</p>
                  {attempt.objectState === 'absent' ? (
                    <label>
                      {fileText.reselect}
                      <input
                        type="file"
                        disabled={uploading}
                        onChange={(event) => void selected(event, attempt)}
                      />
                    </label>
                  ) : attempt.objectState === 'present' ? (
                    <button
                      className="btn btn-sm btn-ghost"
                      disabled={uploading}
                      onClick={() => void retry(attempt)}
                    >
                      {fileText.retryValidation}
                    </button>
                  ) : attempt.objectState === 'unknown' ? (
                    <button
                      className="btn btn-sm btn-ghost"
                      disabled={uploading}
                      onClick={() => setRevision((value) => value + 1)}
                    >
                      {text.retry}
                    </button>
                  ) : null}
                  <p className="field-hint">{fileText.replacementNote}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="cover-section" aria-label={fileText.cover}>
          <h3>{fileText.cover}</h3>
          {/* An empty cover slot is an action, not a picture: the page offers the button
              that adds the record's photograph instead of an empty image frame. */}
          {canEdit && !archived && !coverFileId ? (
            <div className="cover-slot">
              <IconAction
                name="imagePlus"
                label={fileText.addCover}
                disabled={fileInputDisabled}
                onClick={addCoverImage}
              />
              <p className="field-hint">{fileText.addCoverHint}</p>
            </div>
          ) : (
            <CoverImage
              propertyId={propertyId}
              fileId={coverFileId}
              locale={locale}
              onDenied={onDenied}
            />
          )}
          {canEdit && !archived && coverFileId ? (
            <IconAction
              name="remove"
              label={coverBusy ? fileText.changingCover : fileText.clearCover}
              busy={coverBusy}
              disabled={checkingPhoto !== null}
              onClick={() => void changeCover(null)}
            />
          ) : null}
          {coverError ? (
            <p role="alert">
              {fileText.errors[coverError] ?? text.unavailable}
            </p>
          ) : null}
        </section>
        {busy ? (
          <LoadingSkeleton label={text.loading} shape="rows" rows={3} />
        ) : null}
        {error ? (
          <p role="alert">
            {fileText.errors[error] ?? text.unavailable}{' '}
            <button
              className="btn btn-sm btn-ghost"
              disabled={uploading}
              onClick={() => setRevision((value) => value + 1)}
            >
              {text.retry}
            </button>
          </p>
        ) : null}
        {!busy && !error && !files.length ? <p>{fileText.noFiles}</p> : null}
        {!busy ? (
          <ul className="file-list">
            {visibleFiles.map((file) => (
              <li key={file.id} className="doc-row">
                <span className="doc-icon" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    width="20"
                    height="20"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </span>
                <span>
                  <span className="doc-name" translate="no">
                    {file.original_filename}
                  </span>
                  <span className="doc-meta">
                    <span className="badge" data-tone="neutral">
                      {categoryName(file.category_id)}
                    </span>
                    <span className="badge" data-tone="neutral">
                      {file.purpose === 'photo'
                        ? fileText.photo
                        : fileText.document}
                    </span>
                  </span>
                </span>
                <span className="doc-actions">
                  <IconAction
                    name="open"
                    label={fileText.open}
                    busy={signing === file.id}
                    disabled={signing !== null}
                    onClick={() => void open(file.id, false)}
                  />
                  <IconAction
                    name="download"
                    label={fileText.download}
                    disabled={signing !== null}
                    onClick={() => void open(file.id, true)}
                  />
                  {canEdit && !archived && file.purpose === 'photo' ? (
                    file.validated_at && file.validated_object_id ? (
                      coverFileId === file.id ? (
                        <span className="badge" data-tone="success">
                          {fileText.selectedCover}
                        </span>
                      ) : (
                        <IconAction
                          name="imagePlus"
                          label={
                            coverFileId
                              ? fileText.replaceCover
                              : fileText.setCover
                          }
                          disabled={coverBusy || checkingPhoto !== null}
                          onClick={() => void changeCover(file.id)}
                        />
                      )
                    ) : (
                      <IconAction
                        name="refresh"
                        label={fileText.checkPhoto}
                        busy={checkingPhoto === file.id}
                        disabled={coverBusy || checkingPhoto !== null}
                        onClick={() => void checkPhoto(file.id)}
                      />
                    )
                  ) : null}
                  {!archived && (canEdit || file.uploaded_by === employeeId) ? (
                    editingFileId === file.id ? (
                      <div className="field">
                        <label
                          className="field-label"
                          htmlFor={'edit-category-' + file.id}
                        >
                          {fileText.category}
                        </label>
                        <select
                          id={'edit-category-' + file.id}
                          className="select"
                          value={editingCategoryId}
                          disabled={categoryBusy}
                          onChange={(event) =>
                            setEditingCategoryId(event.target.value)
                          }
                        >
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {categoryName(category.id)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={categoryBusy || !editingCategoryId}
                          onClick={() => void changeCategory(file.id)}
                        >
                          {categoryBusy
                            ? fileText.savingCategory
                            : fileText.save}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          disabled={categoryBusy}
                          onClick={() => {
                            setEditingFileId(null);
                            setCategoryError(null);
                          }}
                        >
                          {fileText.cancel}
                        </button>
                        {categoryError ? (
                          <p role="alert">
                            {fileText.errors[categoryError] ?? text.unavailable}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <IconAction
                        name="tag"
                        label={fileText.changeCategory}
                        disabled={categoryBusy}
                        onClick={() => {
                          setEditingFileId(file.id);
                          setEditingCategoryId(file.category_id);
                          setCategoryError(null);
                        }}
                      />
                    )
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {!busy && files.length > FILES_PER_PAGE ? (
          <nav className="pager" aria-label={fileText.files}>
            <IconAction
              name="previous"
              label={fileText.previousPage}
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            />
            <p className="pager-status" role="status">
              {fileText.pagerStatus
                .replace('{page}', String(currentPage + 1))
                .replace('{pages}', String(pageCount))}
            </p>
            <IconAction
              name="next"
              label={fileText.nextPage}
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            />
          </nav>
        ) : null}
        <p className="field-hint">{fileText.availabilityNote}</p>
      </div>
    </section>
  );
}
