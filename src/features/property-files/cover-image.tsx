'use client';
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/i18n/messages';
import { messages } from '@/i18n/messages';
import { api, RequestError } from '@/features/employees/api';
import { fileMessages } from './messages';
import type { SignedFileResponse } from './types';

export function CoverImage({ propertyId, fileId, locale, onDenied }: {
  propertyId: string;
  fileId: string | null;
  locale: Locale;
  onDenied: (status: number) => void;
}) {
  const key = propertyId + '/' + fileId;
  const [resource, setResource] = useState<{ key: string; url?: string; error?: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const text = fileMessages[locale];
  useEffect(() => {
    const version = ++generation.current;
    if (!fileId) return;
    const abort = new AbortController();
    let timer: number | undefined;
    void api<SignedFileResponse>(`/api/properties/${propertyId}/files/${fileId}/signed`, { download: false }, abort.signal)
      .then((result) => {
        if (abort.signal.aborted || generation.current !== version) return;
        setResource({ key, url: result.url });
        timer = window.setTimeout(() => setRevision((value) => value + 1), Math.max(1000, result.expiresAt * 1000 - Date.now() - 5000));
      })
      .catch((failure) => {
        if (abort.signal.aborted || generation.current !== version) return;
        setResource({ key, error: failure instanceof RequestError ? failure.code : 'unavailable' });
        if (failure instanceof RequestError && [401, 403].includes(failure.status)) onDenied(failure.status);
      });
    return () => { abort.abort(); window.clearTimeout(timer); };
  }, [propertyId, fileId, key, revision, onDenied]);
  const current = resource?.key === key ? resource : null;
  return (
    <div className="property-cover" aria-label={text.cover}>
      {!fileId ? <p className="muted">{text.noCover}</p> : current?.url ? (
        // Private bearer URLs must bypass the shared Next.js image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={current.url} width={600} height={400} loading="lazy" decoding="async" referrerPolicy="no-referrer" alt={text.coverPlaceholder}
          style={{ width: '100%', height: 'auto', maxHeight: 300, objectFit: 'contain' }}
          onError={() => setResource({ key, error: 'unavailable' })} />
      ) : current?.error ? (
        <p role="alert">{text.coverImageFailed} <button type="button" onClick={() => { setResource(null); setRevision((value) => value + 1); }}>{messages[locale].retry}</button></p>
      ) : <p role="status">{text.coverLoading}</p>}
    </div>
  );
}
