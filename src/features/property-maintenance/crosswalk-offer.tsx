'use client';
import { useState } from 'react';
import type { Locale } from '@/i18n/messages';
import { api, RequestError } from '@/features/employees/api';
import type { PropertySummary } from '@/features/properties/types';
import { crosswalkMessage, type AddressCrosswalk } from './crosswalk';
import { maintenanceError, maintenanceText } from './messages';

// What the crosswalk says about the legacy ward a save just recorded. Only a single whole or rename
// target offers the one action, and that action is a confirmation by the person: nothing is written
// automatically (D2), and anything else states plainly that it cannot be recorded.
export function CrosswalkOffer({
  locale,
  propertyId,
  address,
  onDenied,
  onRecorded,
}: {
  locale: Locale;
  propertyId: string;
  address: AddressCrosswalk;
  onDenied: (status: number) => void;
  onRecorded: (result: {
    summary?: PropertySummary | null;
  }) => void | Promise<void>;
}) {
  const text = maintenanceText(locale),
    { crosswalk } = address,
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function record() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRecorded(
        await api<{ summary?: PropertySummary | null }>(
          '/api/properties/' + propertyId + '/address-candidate',
          {
            addressId: address.addressId,
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
  return (
    <div className="record">
      <p className="record-body">{crosswalkMessage(locale, crosswalk)}</p>
      {crosswalk.kind === 'mapped' ? (
        <>
          <p className="field-hint">{text.crosswalkCandidateHint}</p>
          <span className="record-actions">
            <button
              type="button"
              className="btn btn-sm"
              onClick={record}
              disabled={busy}
            >
              {busy ? text.saving : text.crosswalkCandidate}
            </button>
          </span>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="field-error">
          {maintenanceError(locale, error)}
        </p>
      ) : null}
    </div>
  );
}
