// The table's ten columns and the cell each property puts in them. Both views read the same
// records, so this projection is the one place the table's columns, their order, the formatted
// values and the missing-value marker are decided — the component only draws what this returns.
import {
  label,
  messages,
  type Locale,
  type MessageKey,
} from '../../i18n/messages.ts';
import { formatDecimal, vietnamDate, vietnamTimestamp } from './format.ts';
import type { PropertySummary } from './types.ts';

// Exactly the ten columns the captain asked for, in this order.
export const TABLE_COLUMNS = [
  'propertyId',
  'createdDate',
  'price',
  'status',
  'houseNumber',
  'street',
  'ward',
  'district',
  'totalArea',
  'modifiedTime',
] as const;
export type TableColumn = (typeof TABLE_COLUMNS)[number];

// The heading each column is announced and labelled with.
export const COLUMN_HEADINGS: Record<TableColumn, MessageKey> = {
  propertyId: 'columnPropertyId',
  createdDate: 'columnCreatedDate',
  price: 'columnPrice',
  status: 'columnStatus',
  houseNumber: 'columnHouseNumber',
  street: 'columnStreet',
  ward: 'columnWard',
  district: 'columnDistrict',
  totalArea: 'columnTotalArea',
  modifiedTime: 'columnModifiedTime',
};

// A recorded value the record does not have renders as an em dash rather than as a blank cell
// that reads like a zero or like "not applicable".
export const MISSING_VALUE = '—';

// The square metre is a unit symbol, not copy: it is the same in both languages.
const SQUARE_METRES = 'm²';

export type TableCell = {
  column: TableColumn;
  text: string;
  // The price is the number people scan the list for, so it is the one cell that carries the
  // strongest type and the tabular numerals a column of numbers lines up in.
  emphasis?: true;
  // The unit a value is stated in, drawn beside the value rather than counted as part of it.
  note?: string;
};

export type PropertyTableRow = {
  id: string;
  // What the row is called when it is read out: the property code, and the recorded address when
  // there is one.
  title: string;
  cells: TableCell[];
};

// Total area means the floor area where it is recorded and the land area otherwise, exactly as
// the captain settled it: the row states one area, never a sum and never both.
export function totalAreaM2(
  record: Pick<PropertySummary, 'floorAreaM2' | 'landAreaM2'>,
): string | null {
  return record.floorAreaM2 ?? record.landAreaM2;
}

// The price a row leads with and the unit it is in. A rent record leads with its monthly rent, a
// sale or sale-and-rent record with its sale price, and a record that holds only the other price
// states that price in its own unit rather than nothing at all.
export function rowPrice(
  record: Pick<
    PropertySummary,
    'listingMode' | 'salePriceVnd' | 'monthlyRentVnd'
  >,
): { value: string; unit: 'vnd' | 'monthly' } | null {
  const { salePriceVnd: sale, monthlyRentVnd: rent } = record;
  if (record.listingMode === 'rent')
    return rent
      ? { value: rent, unit: 'monthly' }
      : sale
        ? { value: sale, unit: 'vnd' }
        : null;
  return sale
    ? { value: sale, unit: 'vnd' }
    : rent
      ? { value: rent, unit: 'monthly' }
      : null;
}

// One row of the table: every column, in the table's own order, with the value it holds or the
// missing-value marker.
export function propertyTableRow(
  record: PropertySummary,
  locale: Locale,
): PropertyTableRow {
  const text = messages[locale];
  const address = record.addresses[0] ?? null;
  const price = rowPrice(record);
  const area = totalAreaM2(record);
  const value = (text: string | null | undefined): string =>
    text && text.trim() ? text : MISSING_VALUE;
  const cells: TableCell[] = [
    { column: 'propertyId', text: value(record.propertyCode) },
    { column: 'createdDate', text: value(vietnamDate(record.createdAt)) },
    price
      ? {
          column: 'price',
          text: formatDecimal(price.value, locale),
          note:
            price.unit === 'monthly'
              ? text.priceUnitMonthly
              : text.priceUnitVnd,
          emphasis: true,
        }
      : { column: 'price', text: MISSING_VALUE, emphasis: true },
    { column: 'status', text: value(label(locale, record.status)) },
    { column: 'houseNumber', text: value(address?.houseNumber ?? null) },
    { column: 'street', text: value(address?.street ?? null) },
    // A current-format address records no district at all; the cell says so with the marker
    // rather than inventing one or leaving the row shorter than the ten columns.
    { column: 'ward', text: value(address?.commune ?? null) },
    { column: 'district', text: value(address?.district ?? null) },
    area
      ? {
          column: 'totalArea',
          text: formatDecimal(area, locale),
          note: SQUARE_METRES,
        }
      : { column: 'totalArea', text: MISSING_VALUE },
    {
      column: 'modifiedTime',
      text: value(vietnamTimestamp(record.updatedAt, locale)),
    },
  ];
  return {
    id: record.id,
    title: address?.addressText
      ? `${record.propertyCode} · ${address.addressText}`
      : record.propertyCode,
    cells,
  };
}
