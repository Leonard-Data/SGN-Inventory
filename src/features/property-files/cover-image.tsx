'use client';
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/i18n/messages';
import { messages } from '@/i18n/messages';
import {
  api,
  isPropertyAccessFailure,
  RequestError,
} from '@/features/employees/api';
import { fileMessages } from './messages';
import type { SignedFileResponse } from './types';

export function CoverImage({
  propertyId,
  fileId,
  locale,
  onDenied,
  onInvalidate,
}: {
  propertyId: string;
  fileId: string | null;
  locale: Locale;
  onDenied: (status: number) => void;
  onInvalidate?: () => void;
}) {
  const key = propertyId + '/' + fileId;
  const [resource, setResource] = useState<{
    key: string;
    url?: string;
    error?: string;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const text = fileMessages[locale];
  useEffect(() => {
    const version = ++generation.current;
    if (!fileId) return;
    const abort = new AbortController();
    let timer: number | undefined;
    void api<SignedFileResponse>(
      `/api/properties/${propertyId}/files/${fileId}/signed`,
      { download: false },
      abort.signal,
    )
      .then((result) => {
        if (generation.current !== version) return;
        setResource({ key, url: result.url });
      })
      .catch((failure) => {
        if (generation.current !== version) return;
        if (failure instanceof RequestError) {
          if (failure.status === 401 || failure.status === 403) {
            timer = window.setTimeout(() => onDenied(failure.status), 0);
            return;
          }
          if (isPropertyAccessFailure(failure)) {
            onInvalidate?.();
            return;
          }
          if (failure.status === 404) {
            setResource({ key, error: 'missing' });
            return;
          }
        }
        setResource({ key, error: 'unavailable' });
      });
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [propertyId, fileId, key, revision, onDenied, onInvalidate]);
  const current = resource?.key === key ? resource : null;
  return (
    <div
      className={'cover' + (!fileId || current?.error ? ' is-empty' : '')}
      aria-label={text.cover}
    >
      {!fileId ? (
        <>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 5h16v14H4z" />
            <path d="M4 15.5 9 10l4.5 4.5L16 12l4 4" />
          </svg>
          <span>{text.noCover}</span>
        </>
      ) : current?.url ? (
        // Private bearer URLs must bypass the shared Next.js image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={current.url}
          width={600}
          height={400}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          alt={text.coverPlaceholder}
          onError={() => setResource({ key, error: 'unavailable' })}
        />
      ) : current?.error ? (
        <p role="alert">
          {text.coverImageFailed}{' '}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setResource(null);
              setRevision((value) => value + 1);
            }}
          >
            {messages[locale].retry}
          </button>
        </p>
      ) : (
        <p role="status">{text.coverLoading}</p>
      )}
    </div>
  );
}
