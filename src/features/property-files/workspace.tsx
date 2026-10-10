'use client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { messages as globalMessages, type Locale } from '@/i18n/messages';
import { fileMessages } from './messages';
import { api, RequestError } from '@/features/employees/api';
import type {
  PropertyFileList,
  SignedFileResponse,
  FileRegistrationResult,
} from './types';

type Upload = {
  id: string;
  filename: string;
  state: 'registering' | 'uploading' | 'validating' | 'ready' | 'failed';
  error?: string;
};

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
  const [uploading, setUploading] = useState(false);
  const [purpose, setPurpose] = useState<'photo' | 'document'>('document');
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const text = globalMessages[locale];
  const fileText = fileMessages[locale];

  useEffect(() => {
    const version = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    void api<PropertyFileList>(
      `/api/properties/${propertyId}/files`,
      undefined,
      abort.signal,
    )
      .then((result) => {
        if (generation.current !== version || abort.signal.aborted) return;
        setFiles(result.files);
        setError(null);
      })
      .catch((failure) => {
        if (generation.current !== version || abort.signal.aborted) return;
        setFiles([]);
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
  }, [propertyId, onDenied, revision]);

  function denied(failure: unknown) {
    if (
      failure instanceof RequestError &&
      (failure.status === 401 || failure.status === 403)
    ) {
      setFiles([]);
      setUploads([]);
      onDenied(failure.status);
      return true;
    }
    return false;
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
      if (version === generation.current && !signal?.aborted)
        window.location.assign(result.url);
    } catch (failure) {
      if (
        version === generation.current &&
        !signal?.aborted &&
        !denied(failure)
      )
        setError(
          failure instanceof RequestError ? failure.code : 'unavailable',
        );
    } finally {
      if (version === generation.current) setSigning(null);
    }
  }
  async function selected(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!selectedFiles.length || uploading) return;
    const version = generation.current;
    const signal = controller.current?.signal;
    setUploading(true);
    for (const file of selectedFiles) {
      if (generation.current !== version || signal?.aborted) break;
      const id = crypto.randomUUID();
      setUploads((rows) => [
        ...rows,
        { id, filename: file.name, state: 'registering' },
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
        if (file.size <= 0) throw new RequestError(400, 'empty-file');
        if (file.size > 20 * 1024 * 1024)
          throw new RequestError(400, 'file-too-large');
        if (
          ![
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/webp',
          ].includes(file.type)
        )
          throw new RequestError(400, 'unsupported-format');
        const digest = new Uint8Array(
          await crypto.subtle.digest('SHA-256', await file.arrayBuffer()),
        );
        let sha256 = '';
        for (const byte of digest) sha256 += byte.toString(16).padStart(2, '0');
        const registration = await api<FileRegistrationResult>(
          `/api/properties/${propertyId}/files/register`,
          {
            fileId: id,
            originalFilename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            sha256,
            purpose,
          },
          signal,
        );
        if (generation.current !== version || signal?.aborted) break;
        update('uploading');
        try {
          await fetch(registration.uploadUrl, {
            method: 'POST',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
            signal,
            headers: {
              'Content-Type': file.type,
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
        // A lost transport response is not a verdict: authoritative byte validation decides completion.
        update('validating');
        await api(
          `/api/properties/${propertyId}/files/${id}/complete`,
          {},
          signal,
        );
        update('ready');
      } catch (failure) {
        if (generation.current !== version || signal?.aborted) break;
        if (denied(failure)) break;
        update(
          'failed',
          failure instanceof RequestError ? failure.code : 'unavailable',
        );
      }
    }
    if (generation.current === version && !signal?.aborted) {
      setUploading(false);
      setRevision((value) => value + 1);
    }
  }
  return (
    <section className="panel" aria-label={fileText.files}>
      <h2>{fileText.files}</h2>
      {!archived && employeeId ? (
        <fieldset disabled={uploading}>
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
              <span className="badge">
                {file.document_type === 'land_certificate'
                  ? fileText.land_certificate
                  : file.document_type === 'sale_contract'
                    ? fileText.sale_contract
                    : file.document_type === 'planning'
                      ? fileText.planning
                      : file.document_type === 'construction_permit'
                        ? fileText.construction_permit
                        : file.document_type === 'photo'
                          ? fileText.photo
                          : fileText.other}
              </span>{' '}
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
