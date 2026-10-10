'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { messages as globalMessages, type Locale } from '@/i18n/messages';
import { fileMessages } from './messages';
import { api, RequestError } from '@/features/employees/api';
import type { PropertyFileList, SignedFileResponse } from './types';

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
  onDenied?: () => void;
}) {
  const [files, setFiles] = useState<PropertyFileList['files'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [signingFileId, setSigningFileId] = useState<string | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    const version = ++generation.current;
    controller.current?.abort();
    setError(null);
    setSignError(null);
    setBusy(true);
    try {
      const data = await api<PropertyFileList>(
        `/api/properties/${propertyId}/files`,
      );
      if (version === generation.current) setFiles(data.files);
    } catch (failure) {
      if (version === generation.current) {
        if (
          failure instanceof RequestError &&
          (failure.status === 401 || failure.status === 403)
        ) {
          onDenied?.();
        } else setError('unavailable');
      }
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }, [propertyId, onDenied]);
  useEffect(() => {
    if (employeeId) {
      void load();
    } else {
      setFiles(null);
      setBusy(false);
    }
  }, [employeeId, load]);
  const signedUrl = useCallback(
    async (fileId: string, download: boolean) => {
      setSigningFileId(fileId);
      setSignError(null);
      try {
        const result = await api<SignedFileResponse>(
          `/api/properties/${propertyId}/files/${fileId}/signed`,
          { download },
        );
        if (download) {
          // Navigate directly — Supabase signed URL triggers download header
          window.location.href = result.url;
        } else {
          window.open(result.url, '_blank');
        }
      } catch (failure) {
        if (
          failure instanceof RequestError &&
          (failure.status === 401 || failure.status === 403)
        ) {
          onDenied?.();
        } else setSignError('signedFailed');
      } finally {
        setSigningFileId(null);
      }
    },
    [propertyId, onDenied],
  );
  const text = globalMessages[locale];
  const fileText = fileMessages[locale];
  // Map document_type to label key; six fixed types
  const docTypeLabel = (docType: string): string => {
    const key = docType.toLowerCase() as keyof typeof fileText;
    if (key in fileText) return fileText[key];
    return fileText.other;
  };
  if (error)
    return (
      <section className="panel">
        <h2>{fileText.files}</h2>
        <p role="alert">{error === 'unavailable' ? text.unavailable : error}</p>
      </section>
    );
  return (
    <section className="panel">
      <h2>{fileText.files}</h2>
      {busy ? <p role="status">{text.loading}</p> : null}
      {files !== null && files.length === 0 && !busy ? (
        <p>{fileText.noFiles}</p>
      ) : null}
      {files !== null && files.length > 0 ? (
        <ul className="file-list">
          {files.map((file) => (
            <li key={file.id} className="file-row">
              <span className="file-name" translate="no">
                {file.original_filename}
              </span>
              <span className="file-type badge">
                {docTypeLabel(file.document_type)}
              </span>
              <span className="file-actions">
                <button
                  type="button"
                  disabled={signingFileId === file.id || !employeeId}
                  onClick={() => signedUrl(file.id, false)}
                >
                  {signingFileId === file.id
                    ? fileText.signingFile
                    : fileText.open}
                </button>
                <button
                  type="button"
                  disabled={signingFileId === file.id || !employeeId}
                  onClick={() => signedUrl(file.id, true)}
                >
                  {signingFileId === file.id
                    ? fileText.signingFile
                    : fileText.download}
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="muted">{fileText.availabilityNote}</p>
      {signError ? (
        <p role="alert">
          {fileText.signedFailed}{' '}
          <button onClick={load}>{text.retry}</button>
        </p>
      ) : null}
    </section>
  );
}
