'use client';
import Link from 'next/link';
import { useState } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { api, RequestError } from '@/features/employees/api';
import { useProtectedData } from '@/features/employees/use-protected-data';
import type { Vendor, VendorLink, VendorPage } from './types';

// The choice line keeps the company name first and adds only recorded details, so two
// similarly named companies stay distinguishable without inventing an identity match.
function optionText(vendor: Vendor) {
  const details = [vendor.contactName, vendor.phones?.join(' / ')].filter(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  return [vendor.displayName, ...details, vendor.email]
    .filter(Boolean)
    .join(' — ');
}

// A property's own Vendor section. Supplier companies stay separate from owners and
// brokers, and a link never implies ownership, reservation state or occupancy. Every
// property reader sees the recorded relationships; staff, managers and admins link a
// recorded vendor and correct a mistaken link without deleting the company or its history.
export function PropertyVendors({
  propertyId,
  propertyRevision,
  canLink,
  locale,
  onChanged,
  onDenied,
}: {
  propertyId: string;
  propertyRevision: string;
  canLink: boolean;
  locale: Locale;
  onChanged: () => void | Promise<void>;
  onDenied: (status: number) => void;
}) {
  const text = messages[locale];
  const { data, error, busy, surface, reload } = useProtectedData<{
    vendors: VendorLink[];
  }>('/api/properties/' + propertyId + '/vendors');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<VendorPage | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchProblem, setSearchProblem] = useState(false);
  const [chosen, setChosen] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [actionProblem, setActionProblem] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function search() {
    setSearching(true);
    setSearchProblem(false);
    try {
      const page = await api<VendorPage>(
        '/api/vendors?' + new URLSearchParams({ query }).toString(),
      );
      setFound(page);
      setChosen(page.vendors[0]?.id ?? '');
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        onDenied(failure.status);
        return;
      }
      setFound(null);
      setSearchProblem(true);
    } finally {
      setSearching(false);
    }
  }

  // A kept draft and a read-back of the recorded relationships: no optimistic local link
  // and no automatic resubmission after an unconfirmed outcome.
  async function call(work: () => Promise<unknown>, done: string) {
    if (actionBusy) return;
    setActionBusy(true);
    setActionProblem(null);
    setNotice(null);
    try {
      await work();
      setNotice(done);
      setConfirming(null);
      setFound(null);
      setQuery('');
      setChosen('');
      // The parent re-reads the property, so the section and its history show the committed
      // relationship and a failed context is replaced by the current revision.
      await onChanged();
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        onDenied(failure.status);
        return;
      }
      setActionProblem(
        failure instanceof RequestError && failure.code === 'stale-edit'
          ? text.vendorLinkStale
          : failure instanceof RequestError && failure.code === 'not-found'
            ? text.vendorLinkMissing
            : failure instanceof RequestError &&
                failure.code === 'invalid-input'
              ? text.vendorLinkInvalid
              : text.vendorLinkFailed,
      );
    } finally {
      setActionBusy(false);
    }
  }

  const vendors = data?.vendors ?? null;
  return (
    <div className="panel" data-od-id="panel-vendors">
      <div className="panel-head">
        <h2>{text.vendorsLink}</h2>
      </div>
      <div className="panel-body">
        {busy && !data ? <p role="status">{text.loading}</p> : null}
        {error ? (
          <div className="alert" data-tone="danger" role="alert">
            <span>
              {error === 'invalid-input'
                ? text.invalidInput
                : text.vendorPropertyFailed}
            </span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={reload}
            >
              {text.retry}
            </button>
          </div>
        ) : null}
        <div ref={surface} hidden={!data || busy}>
          {vendors ? (
            <>
              {vendors.length ? (
                vendors.map((vendor) => (
                  <div className="record" key={vendor.vendorId}>
                    <div className="record-head">
                      <Link
                        className="record-title"
                        href={'/people/vendors/' + vendor.vendorId}
                        prefetch={false}
                        translate="no"
                      >
                        {vendor.displayName}
                      </Link>
                    </div>
                    <p className="record-meta">
                      {vendor.contactName ?? text.unknown} ·{' '}
                      <span translate="no">
                        {vendor.phones?.join(' / ') ||
                          vendor.email ||
                          text.unknown}
                      </span>
                    </p>
                    {canLink ? (
                      <span className="record-actions">
                        {confirming === vendor.vendorId ? (
                          <span role="group" aria-label={text.vendorUnlink}>
                            <span className="field-hint">
                              {text.vendorUnlinkConfirm}
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={actionBusy}
                              onClick={() =>
                                void call(
                                  () =>
                                    api(
                                      '/api/properties/' +
                                        propertyId +
                                        '/vendors/' +
                                        vendor.vendorId,
                                      { revision: vendor.revision },
                                    ),
                                  text.vendorUnlinked,
                                )
                              }
                            >
                              {text.vendorUnlinkYes}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              disabled={actionBusy}
                              onClick={() => setConfirming(null)}
                            >
                              {text.cancel}
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => {
                              setNotice(null);
                              setConfirming(vendor.vendorId);
                            }}
                          >
                            {text.vendorUnlink}
                          </button>
                        )}
                      </span>
                    ) : null}
                  </div>
                ))
              ) : (
                <p>{text.vendorPropertyEmpty}</p>
              )}
            </>
          ) : null}
        </div>
        {notice ? <p role="status">{notice}</p> : null}
        {actionProblem ? (
          <div className="alert" data-tone="danger" role="alert">
            <span>{actionProblem}</span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setActionProblem(null);
                void onChanged();
              }}
            >
              {text.refresh}
            </button>
          </div>
        ) : null}
        <p className="field-hint">{text.vendorPropertyNote}</p>
        {canLink ? (
          <details className="maintenance">
            <summary>{text.vendorLinkOpen}</summary>
            <div className="field">
              <label className="field-label" htmlFor="vendor-link-search">
                {text.vendorSearch}
              </label>
              <input
                id="vendor-link-search"
                className="input"
                value={query}
                maxLength={120}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="button"
                className="btn btn-sm"
                disabled={searching}
                onClick={() => void search()}
              >
                {searching ? text.loading : text.vendorSearch}
              </button>
            </div>
            {searchProblem ? (
              <div className="alert" data-tone="danger" role="alert">
                <span>{text.vendorDirectoryFailed}</span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => void search()}
                >
                  {text.retry}
                </button>
              </div>
            ) : null}
            {found ? (
              found.vendors.length ? (
                <>
                  <div className="field">
                    <label className="field-label" htmlFor="vendor-link-choose">
                      {text.vendorLinkChoose}
                    </label>
                    <select
                      id="vendor-link-choose"
                      value={chosen}
                      onChange={(event) => setChosen(event.target.value)}
                    >
                      {found.vendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>
                          {optionText(vendor)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={actionBusy || chosen === ''}
                    onClick={() =>
                      void call(
                        () =>
                          api('/api/properties/' + propertyId + '/vendors', {
                            vendorId: chosen,
                            propertyRevision,
                          }),
                        text.vendorLinkLinked,
                      )
                    }
                  >
                    {text.vendorLinkSubmit}
                  </button>
                </>
              ) : (
                <p>{text.vendorLinkNone}</p>
              )
            ) : null}
          </details>
        ) : null}
      </div>
    </div>
  );
}
