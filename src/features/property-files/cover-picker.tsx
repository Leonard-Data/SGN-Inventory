'use client';
import { useEffect, useRef, useState } from 'react';
import { messages as globalMessages, type Locale } from '@/i18n/messages';
import { api, RequestError } from '@/features/employees/api';
import { CoverImage } from './cover-image';
import { fileMessages } from './messages';
import type { PropertyFile, PropertyFileList } from './types';

// The card image is the one Property photo the inventory card shows. Only a completed,
// technically validated photo is eligible, and the choice is committed by set_property_cover
// through the cover route: this view writes no property row and no stored object itself.
export function CoverPicker({
  propertyId,
  locale,
  coverFileId,
  canEdit,
  archived,
  onDenied,
  onChanged,
}: {
  propertyId: string;
  locale: Locale;
  coverFileId: string | null;
  canEdit: boolean;
  archived: boolean;
  onDenied: (status: number) => void;
  onChanged: () => void;
}) {
  const [files, setFiles] = useState<PropertyFile[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const text = fileMessages[locale];
  const globalText = globalMessages[locale];
  const editable = canEdit && !archived;
  useEffect(() => {
    const version = ++generation.current;
    const abort = new AbortController();
    api<PropertyFileList>(
      `/api/properties/${propertyId}/files`,
      undefined,
      abort.signal,
    )
      .then((result) => {
        if (generation.current !== version || abort.signal.aborted) return;
        setFiles(result.files.filter((file) => file.purpose === 'photo'));
        setError(null);
      })
      .catch((failure: unknown) => {
        if (generation.current !== version || abort.signal.aborted) return;
        if (
          failure instanceof RequestError &&
          (failure.status === 401 || failure.status === 403)
        ) {
          onDenied(failure.status);
          return;
        }
        setError(
          failure instanceof RequestError ? failure.code : 'unavailable',
        );
      })
      .finally(() => {
        if (generation.current === version) setBusy(false);
      });
    return () => abort.abort();
  }, [propertyId, revision, onDenied]);
  async function commit(id: string, call: () => Promise<unknown>) {
    if (working) return;
    setWorking(id);
    setError(null);
    try {
      await call();
      onChanged();
      setRevision((value) => value + 1);
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        onDenied(failure.status);
        return;
      }
      setError(failure instanceof RequestError ? failure.code : 'unavailable');
    } finally {
      setWorking(null);
    }
  }
  return (
    <div>
      <CoverImage
        propertyId={propertyId}
        fileId={coverFileId}
        locale={locale}
        onDenied={onDenied}
      />
      <p className="field-hint">{text.cardImageNote}</p>
      {editable && coverFileId ? (
        <p>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={working !== null}
            onClick={() =>
              void commit('clear', () =>
                api(`/api/properties/${propertyId}/cover`, { fileId: null }),
              )
            }
          >
            {working === 'clear' ? text.changingCover : text.clearCover}
          </button>
        </p>
      ) : null}
      {busy ? <p role="status">{globalText.loading}</p> : null}
      {error ? (
        <p role="alert">{text.errors[error] ?? globalText.unavailable}</p>
      ) : null}
      {!busy && !files.length ? <p>{text.cardImageEmpty}</p> : null}
      {!busy && files.length ? (
        <ul className="file-list">
          {files.map((file) => {
            const validated = !!(file.validated_at && file.validated_object_id);
            return (
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
                    <path d="M4 5h16v14H4z" />
                    <path d="M4 15.5 9 10l4.5 4.5L16 12l4 4" />
                  </svg>
                </span>
                <span>
                  <span className="doc-name" translate="no">
                    {file.original_filename}
                  </span>
                  <span className="doc-meta">
                    {validated ? text.ready : text.failed}
                  </span>
                </span>
                <span className="doc-actions">
                  {!editable ? null : coverFileId === file.id ? (
                    <span className="badge" data-tone="success">
                      {text.selectedCover}
                    </span>
                  ) : validated ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={working !== null}
                      onClick={() =>
                        void commit(file.id, () =>
                          api(`/api/properties/${propertyId}/cover`, {
                            fileId: file.id,
                          }),
                        )
                      }
                    >
                      {working === file.id
                        ? text.changingCover
                        : coverFileId
                          ? text.replaceCover
                          : text.setCover}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={working !== null}
                      onClick={() =>
                        void commit(file.id, () =>
                          api(
                            `/api/properties/${propertyId}/files/${file.id}/complete`,
                            {},
                          ),
                        )
                      }
                    >
                      {working === file.id ? text.validating : text.checkPhoto}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
