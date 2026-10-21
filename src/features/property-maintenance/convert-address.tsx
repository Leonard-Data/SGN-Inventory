'use client';
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/i18n/messages';
import { api, RequestError } from '@/features/employees/api';
import type { PropertySummary } from '@/features/properties/types';
import { conversionTarget } from './crosswalk';
import { maintenanceError, maintenanceText } from './messages';

// An existing address changes format only through this labelled action, never through an ordinary
// save. It asks for confirmation first and states what it writes, so cancelling leaves the
// property's addresses exactly as they were. The target format is the row's own counterpart, so
// the button says which of the two it writes.
export function AddressConversion({
  locale,
  propertyId,
  address,
  format,
  onDenied,
  onConverted,
}: {
  locale: Locale;
  propertyId: string;
  address: { id: string; revision: string; propertyRevision: string };
  format: string;
  onDenied: (status: number) => void;
  onConverted: (result: {
    summary?: PropertySummary | null;
  }) => void | Promise<void>;
}) {
  // A row the crosswalk relates in neither direction - an alternate source record - offers nothing.
  const target = conversionTarget(format);
  const text = maintenanceText(locale),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    confirmRef = useRef<HTMLButtonElement>(null);
  // Opening states the consequence in place of the button that opened it, so focus follows the
  // statement to the confirmation rather than starting again from the top of the record.
  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);
  async function convert() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConverted(
        await api<{ summary?: PropertySummary | null }>(
          '/api/properties/' + propertyId + '/address-conversion',
          {
            addressId: address.id,
            addressRevision: address.revision,
            propertyRevision: address.propertyRevision,
          },
        ),
      );
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        onDenied(failure.status);
        return;
      }
      setError(
        failure instanceof RequestError ? failure.code : 'invalid-input',
      );
    } finally {
      setBusy(false);
    }
  }
  if (!target) return null;
  const label = maintenanceError(locale, error);
  return open ? (
    <div
      className="record"
      role="group"
      aria-label={
        target === 'current' ? text.convertToCurrent : text.convertToLegacy
      }
    >
      <p className="field-hint">{text.convertHint}</p>
      <span className="record-actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={convert}
          disabled={busy}
          ref={confirmRef}
        >
          {busy ? text.saving : text.convertConfirm}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          {text.cancel}
        </button>
      </span>
      {error ? (
        <p role="alert" className="field-error">
          {label}
        </p>
      ) : null}
    </div>
  ) : (
    <span className="record-actions">
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={() => setOpen(true)}
      >
        {target === 'current' ? text.convertToCurrent : text.convertToLegacy}
      </button>
    </span>
  );
}
