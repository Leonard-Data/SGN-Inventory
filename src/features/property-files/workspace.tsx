'use client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { messages as globalMessages, type Locale } from '@/i18n/messages';
import { fileMessages } from './messages';
import { api, RequestError } from '@/features/employees/api';
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

export function Workspace({
  propertyId,
  locale,
  employeeId,
  archived,
  onDenied,
}: {
  propertyId: string;
  locale: Locale;
  employeeId: string | null;
  archived: boolean;
  onDenied: (status: number) => void;
}) {
  const [files, setFiles] = useState<PropertyFileList['files']>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [signing, setSigning] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [recoverable, setRecoverable] = useState<RecoverableFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [purpose, setPurpose] = useState<'photo' | 'document'>('document');
  const [categories, setCategories] = useState<DocumentCategoryList['categories']>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(otherCategoryId);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const text = globalMessages[locale];
  const fileText = fileMessages[locale];

  useEffect(() => {
    const version = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    void Promise.all([
      api<PropertyFileList>(
        `/api/properties/${propertyId}/files`,
        undefined,
        abort.signal,
      ),
      archived || !employeeId
        ? Promise.resolve<FileRecoveryList>({ uploads: [] })
        : api<FileRecoveryList>(
            `/api/properties/${propertyId}/files/recovery`,
            undefined,
            abort.signal,
          ),
      api<DocumentCategoryList>(
        '/api/document-categories',
        undefined,
        abort.signal,
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
        if (
          failure instanceof RequestError &&
          (failure.status === 401 || failure.status === 403)
        )
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
    if (
      failure instanceof RequestError &&
      (failure.status === 401 || failure.status === 403)
    ) {
      onDenied(failure.status);
      return true;
    }
    return false;
  }

  async function open(fileId: string, download: boolean) {
    setSigning(fileId);
    try {
      const result = await api<SignedFileResponse>(
        `/api/properties/${propertyId}/files/${fileId}/signed`,
        { download },
      );
      window.open(result.url, '_blank');
    } catch (failure) {
      denied(failure);
    } finally {
      setSigning(null);
    }
  }

  function categoryName(id: string): string {
    const cat = categories.find((c) => c.id === id);
    if (!cat) return fileText.otherCategory;
    if (cat.builtin === 'other') return fileText.otherCategory;
    if (cat.builtin === 'land_certificate') return fileText.land_certificate;
    if (cat.builtin === 'sale_contract') return fileText.sale_contract;
    if (cat.builtin === 'planning') return fileText.planning;
    if (cat.builtin === 'construction_permit') return fileText.construction_permit;
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
        if (file.size > 20 * 1024 * 1024)
          throw new RequestError(400, 'file-too-large');
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
        try {
          await fetch(registration.uploadUrl, {
            method: 'POST',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
            signal,
            headers: {
              'Content-Type': recovery?.file.mime_type ?? file!.type,
              apikey: registration.publishableKey,
              Authorization: 'Bearer ' + registration.accessToken,
              'x-upsert': 'false',
              'cache-control': 'private, no-store',
            },
            body: file,
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
      const result = await api<{ id: string }>('/api/document-categories', { name }, signal);
      const fresh = await api<DocumentCategoryList>('/api/document-categories', undefined, signal);
      if (generation.current !== version || signal?.aborted) return;
      setCategories(fresh.categories);
      setSelectedCategoryId(result.id);
      setShowNewCategory(false);
      setNewCategoryName('');
    } catch (failure) {
      if (generation.current === version && !signal?.aborted && !denied(failure))
        setError(failure instanceof RequestError ? failure.code : 'unavailable');
    } finally {
      if (generation.current === version) setCreatingCategory(false);
    }
  }

  return (
    <section className="panel" aria-label={fileText.files}>
      <h2>{fileText.files}</h2>
      {!archived && employeeId ? (
        <fieldset disabled={uploading || creatingCategory || busy}>
          <legend>{fileText.purpose}</legend>
          <label>
            <input
              type="radio"
              name="file-purpose"
              checked={purpose === 'document'}
              onChange={() => setPurpose('document')}
            />
            {fileText.document}
          </label>
          <label>
            <input
              type="radio"
              name="file-purpose"
              checked={purpose === 'photo'}
              onChange={() => setPurpose('photo')}
            />
            {fileText.photo}
          </label>
          <div>
            <label htmlFor={'category-' + propertyId}>{fileText.category}</label>
            <select
              id={'category-' + propertyId}
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
            <div>
              <label htmlFor={'new-category-' + propertyId}>
                {fileText.categoryName}
              </label>
              <input
                id={'new-category-' + propertyId}
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
                disabled={creatingCategory || !newCategoryName.trim()}
                onClick={() => void handleCreateCategory()}
              >
                {fileText.createCategory}
              </button>
            </div>
          ) : null}
          <label htmlFor={'files-' + propertyId}>{fileText.selectFiles}</label>
          <input
            id={'files-' + propertyId}
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/webp"
            aria-describedby={'upload-note-' + propertyId}
            onChange={(event) => void selected(event)}
          />
          <p id={'upload-note-' + propertyId} className="muted">
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
                    disabled={uploading}
                    onClick={() => void retry(attempt)}
                  >
                    {fileText.retryValidation}
                  </button>
                ) : attempt.objectState === 'unknown' ? (
                  <button
                    disabled={uploading}
                    onClick={() => setRevision((value) => value + 1)}
                  >
                    {text.retry}
                  </button>
                ) : null}
                <p className="muted">{fileText.replacementNote}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {busy ? <p role="status">{text.loading}</p> : null}
      {error ? (
        <p role="alert">
          {fileText.errors[error] ?? text.unavailable}{' '}
          <button
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
          {files.map((file) => (
            <li key={file.id} className="file-row">
              <span className="file-name" translate="no">
                {file.original_filename}
              </span>{' '}
              <span className="badge">{categoryName(file.category_id)}</span>{' '}
              <span className="badge">
                {file.purpose === 'photo' ? fileText.photo : fileText.document}
              </span>{' '}
              <button
                type="button"
                disabled={signing !== null}
                onClick={() => void open(file.id, false)}
              >
                {signing === file.id ? fileText.signingFile : fileText.open}
              </button>{' '}
              <button
                type="button"
                disabled={signing !== null}
                onClick={() => void open(file.id, true)}
              >
                {fileText.download}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="muted">{fileText.availabilityNote}</p>
    </section>
  );
}
