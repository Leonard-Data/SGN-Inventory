'use client';
import { useId, useState } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import {
  PRICE_UNITS,
  PRICE_UNIT_LABEL,
  amountInUnit,
  formatVnd,
  parsePriceAmount,
  priceNeedsConfirmation,
  type PriceUnit,
} from './format';

// A price typed the way people say it, with the whole-VND amount it will save stated live beneath
// it. The submitted value - the only value it submits - is that whole-VND amount, so the stored
// price keeps the form it always had.
export function PriceInput({
  id,
  name,
  value,
  locale,
  unit: openingUnit,
  kind,
  invalid = false,
}: {
  id: string;
  name: string;
  // The recorded price as whole VND text, or null when the record states none.
  value: string | null;
  locale: Locale;
  // The unit an unrecorded field opens on: tỷ for an asking sale price, triệu for monthly rent.
  unit: PriceUnit;
  // Which asking price this is, because the implausible-magnitude check is about a sale price.
  kind: 'sale' | 'rent';
  invalid?: boolean;
}) {
  const text = messages[locale];
  const [unit, setUnit] = useState(openingUnit);
  // A recorded price opens in a human unit, and the line under it confirms the same stored amount.
  const [typed, setTyped] = useState(() =>
    value ? amountInUnit(value, openingUnit, locale) : '',
  );
  const vnd = parsePriceAmount(typed, unit),
    expandedId = useId() + '-expanded';
  // The line under the field is the description whenever it carries one.
  const describedBy = typed.trim() ? expandedId : undefined;
  return (
    <>
      <div className="field-price">
        <input
          id={id}
          className="input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.currentTarget.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
        <select
          className="select"
          aria-label={text.priceUnit}
          aria-describedby={describedBy}
          value={unit}
          onChange={(event) => setUnit(event.currentTarget.value as PriceUnit)}
        >
          {PRICE_UNITS.map((option) => (
            <option key={option} value={option}>
              {PRICE_UNIT_LABEL[option]}
            </option>
          ))}
        </select>
      </div>
      {/* An amount that is not whole VND reaches the server exactly as it was typed, so it is
          refused by the validation that refuses any other bad input rather than saved as a guess. */}
      <input
        type="hidden"
        name={name}
        value={vnd ?? typed.trim()}
        {...(vnd !== null && priceNeedsConfirmation(vnd, unit, kind)
          ? { 'data-price-confirm': '' }
          : {})}
      />
      {typed.trim() ? (
        <p
          className={
            vnd === null ? 'field-error' : 'field-hint field-price-total'
          }
          id={expandedId}
          aria-live="polite"
        >
          {vnd === null
            ? text.priceInvalid
            : text.priceSaves + ' ' + formatVnd(vnd, locale)}
        </p>
      ) : null}
    </>
  );
}

// An implausible amount is saved only after the person confirms the amount stated under it.
export function confirmsPrice(form: HTMLFormElement, locale: Locale): boolean {
  return (
    !form.querySelector('[data-price-confirm]') ||
    window.confirm(messages[locale].priceConfirm)
  );
}
