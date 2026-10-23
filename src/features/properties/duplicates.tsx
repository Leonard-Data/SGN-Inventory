'use client';
import { useEffect, useState } from 'react';
import { label, messages, type Locale } from '@/i18n/messages';
import { RequestError } from '@/features/employees/api';
import { DetailActionDialog } from './detail-dialog';
import { detailMessages } from './messages';
import { loadAddressGroup, mergeAddressGroup } from './detail-loader';
import { applyServerSummary } from './catalogue-changes';
import { useCatalogueChange } from './catalogue-provider';
import { dimensions } from './dimension-summary';
import { formatDecimal, formatInteger, formatVnd } from './format';
import { mergeLimit } from './merge-rules';
import type { AddressGroup, MergeReport } from './types';

function decimal(value: string | null, locale: Locale): string | null {
  return value === null ? null : formatDecimal(value, locale);
}

type PendingBlocker = { propertyCode: string; requester: string };

// The refusal names the records and requesters the server reported, so a manager can resolve
// those requests first.
function blockedBy(details: unknown): string {
  if (!Array.isArray(details)) return '';
  return details
    .filter(
      (row): row is PendingBlocker =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as PendingBlocker).propertyCode === 'string' &&
        typeof (row as PendingBlocker).requester === 'string',
    )
    .map((row) => `${row.propertyCode} (${row.requester})`)
    .join(', ');
}

// The guarded merge names why it refused, so the browser can say it instead of "unavailable".
function mergeFailure(
  code: string,
  locale: Locale,
  text: (typeof messages)[Locale],
  groupSize: number,
  details?: unknown,
): string {
  const dt = detailMessages[locale];
  if (code === 'merge-target') return dt.mergeTarget;
  if (code === 'address-mismatch') return dt.addressMismatch;
  if (code === 'file-move-incomplete') return dt.fileMoveIncomplete;
  if (code === 'reservation-conflict') return dt.reservationConflict;
  if (code === 'rental-active') return dt.rentalActive;
  if (code === 'merge-archived') return dt.mergeArchived;
  if (code === 'merge-conflict') return dt.mergeConflict;
  if (code === 'pending-reservation')
    return dt.mergePending.replace('{blockers}', blockedBy(details));
  if (code === 'merge-too-large')
    return dt.mergeTooLarge
      .replace('{count}', formatInteger(groupSize, locale))
      .replace('{limit}', formatInteger(mergeLimit, locale));
  if (code === 'invalid-input') return text.invalidInput;
  if (code === 'not-found') return text.notFound;
  return text.unavailable;
}

// A shared address says how many other properties carry it and opens the comparison. Two
// outcomes: keep both, which closes without changing anything, or fold the group into the most
// complete record, which is a manager/admin confirmation naming both records.
export function SharedAddress({
  propertyId,
  locale,
  canMerge,
  onDenied,
  onMerged,
}: {
  propertyId: string;
  locale: Locale;
  canMerge: boolean;
  onDenied: (status: number) => void;
  onMerged: () => void;
}) {
  const text = messages[locale];
  const dt = detailMessages[locale];
  const [group, setGroup] = useState<AddressGroup | null>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [report, setReport] = useState<MergeReport | null>(null);
  // A merge retires the records it folded in, so the browser's catalogue drops them and takes the
  // surviving record's summary from the server's own answer.
  const applyChange = useCatalogueChange();

  useEffect(() => {
    const abort = new AbortController();
    let current = true;
    loadAddressGroup(propertyId, abort.signal)
      .then((value) => {
        if (current) setGroup(value);
      })
      .catch((problem: unknown) => {
        if (!current || abort.signal.aborted) return;
        if (
          problem instanceof RequestError &&
          (problem.status === 401 || problem.status === 403)
        ) {
          onDenied(problem.status);
          return;
        }
        // An advisory read: a failed one shows no indicator rather than claiming the address
        // is unique, and it never blocks the record it belongs to.
        setGroup(null);
      });
    return () => {
      current = false;
      abort.abort();
    };
  }, [propertyId, onDenied]);

  const members = group?.members ?? [];
  const keepId = group?.keepId ?? null;
  const others = members.filter((member) => member.id !== keepId);
  if (!keepId || others.length === 0) return null;
  const keep = members.find((member) => member.id === keepId);
  const mergedCodes = others.map((member) => member.propertyCode).join(', ');

  function close() {
    setOpen(false);
    setConfirming(false);
    setFailure(null);
    if (report) {
      setReport(null);
      onMerged();
    }
  }

  async function merge() {
    if (busy || !keepId) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await mergeAddressGroup(
        keepId,
        others.map((member) => member.id),
      );
      for (const record of result.merged)
        applyChange({ kind: 'remove', id: record.id });
      applyServerSummary(applyChange, result, keepId);
      setReport(result);
      setConfirming(false);
    } catch (problem) {
      if (
        problem instanceof RequestError &&
        (problem.status === 401 || problem.status === 403)
      ) {
        onDenied(problem.status);
        return;
      }
      setFailure(
        mergeFailure(
          problem instanceof RequestError ? problem.code : 'unavailable',
          locale,
          text,
          others.length,
          problem instanceof RequestError ? problem.details : undefined,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="alert" data-tone="neutral" role="status">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1" />
        </svg>
        <span>
          {dt.sharedAddressCount.replace(
            '{n}',
            formatInteger(members.length - 1, locale),
          )}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={() => setOpen(true)}
        >
          {dt.compare}
        </button>
      </div>

      <DetailActionDialog
        open={open}
        onClose={close}
        title={dt.compareTitle}
        closeLabel={text.close}
      >
        {report ? (
          <div>
            <div className="alert" data-tone="success" role="status">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m5 13 4 4L19 7" />
              </svg>
              <span>
                {dt.mergeDone
                  .replace(
                    '{merged}',
                    report.merged
                      .map((member) => member.propertyCode)
                      .join(', '),
                  )
                  .replace('{keep}', report.keep.propertyCode)}
              </span>
            </div>
            <p>
              {dt.mergeMoved
                .replace('{files}', formatInteger(report.moved.files, locale))
                .replace(
                  '{links}',
                  formatInteger(report.moved.contactLinks, locale),
                )
                .replace(
                  '{history}',
                  formatInteger(report.moved.history, locale),
                )}
            </p>
            {report.moved.alreadyLinked ? (
              <p>
                {dt.mergeShared.replace(
                  '{n}',
                  formatInteger(report.moved.alreadyLinked, locale),
                )}
              </p>
            ) : null}
            <p className="field-hint">
              {dt.mergeRetired.replace(
                '{merged}',
                report.merged.map((member) => member.propertyCode).join(', '),
              )}
            </p>
            <div className="chips">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={close}
              >
                {text.close}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p>{dt.compareNote}</p>
            <table className="data-table stackable">
              <thead>
                <tr>
                  <th scope="col">{dt.recordColumn}</th>
                  <th scope="col">{text.salePrice}</th>
                  <th scope="col">{text.floorArea}</th>
                  <th scope="col">{dt.dimensions}</th>
                  <th scope="col">{text.owner}</th>
                  <th scope="col">{text.status}</th>
                  <th scope="col">{text.listingMode}</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const floor = decimal(member.floorAreaM2, locale);
                  const size = dimensions(member, locale);
                  return (
                    <tr key={member.id}>
                      <td data-label={dt.recordColumn}>
                        <b translate="no">{member.propertyCode}</b>
                        {member.id === keepId ? (
                          <small>{dt.keepBadge}</small>
                        ) : null}
                      </td>
                      <td data-label={text.salePrice} data-num>
                        {member.salePriceVnd === null
                          ? text.unknown
                          : formatVnd(member.salePriceVnd, locale)}
                      </td>
                      <td data-label={text.floorArea} data-num>
                        {floor === null ? text.unknown : `${floor} m²`}
                      </td>
                      <td data-label={dt.dimensions} data-num>
                        {size ?? text.unknown}
                      </td>
                      <td data-label={text.owner}>
                        {member.owners.length ? (
                          <span translate="no">{member.owners.join(', ')}</span>
                        ) : (
                          text.unknown
                        )}
                      </td>
                      <td data-label={text.status}>
                        {label(locale, member.status)}
                      </td>
                      <td data-label={text.listingMode}>
                        {label(locale, member.listingMode)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {failure ? (
              <div className="alert" data-tone="danger" role="alert">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
                <span>{failure}</span>
              </div>
            ) : null}

            {confirming ? (
              <div className="alert" data-tone="danger" role="alert">
                <div>
                  <p>
                    {dt.mergeConfirm
                      .replace('{keep}', keep?.propertyCode ?? '')
                      .replace('{merged}', mergedCodes)}
                  </p>
                  <p>{dt.mergeWarning}</p>
                </div>
              </div>
            ) : null}

            <div className="chips">
              {confirming ? (
                <>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={merge}
                    disabled={busy}
                    aria-busy={busy}
                  >
                    {busy ? text.loading : dt.mergeConfirmAction}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      setConfirming(false);
                      setFailure(null);
                    }}
                    disabled={busy}
                  >
                    {text.cancel}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={close}
                  >
                    {dt.keepBoth}
                  </button>
                  {canMerge && others.length <= mergeLimit ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => setConfirming(true)}
                    >
                      {dt.mergeStart}
                    </button>
                  ) : null}
                </>
              )}
            </div>
            {canMerge ? null : <p className="field-hint">{dt.mergeDenied}</p>}
            {canMerge && others.length > mergeLimit ? (
              <p className="field-hint">
                {dt.mergeTooLarge
                  .replace('{count}', formatInteger(others.length, locale))
                  .replace('{limit}', formatInteger(mergeLimit, locale))}
              </p>
            ) : null}
          </div>
        )}
      </DetailActionDialog>
    </>
  );
}
