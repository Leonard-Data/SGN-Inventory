// The table's ten columns and the cell each property puts in them. Both views read the same
// records, so this projection is the one place the table's columns, their order, the formatted
// values and the missing-value marker are decided — the component only draws what this returns.
import {
  label,
  messages,
  type Locale,
  type MessageKey,
} from '../../i18n/messages.ts';
import {
  formatDecimal,
  formatInteger,
  relativeTime,
  vietnamDate,
} from './format.ts';
import type { AddressSummary, PropertySummary } from './types.ts';

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

// The summary groups the existing facts; the full record still exposes every source field.
export const SUMMARY_TABLE_COLUMNS = [
  'property',
  'address',
  'price',
  'totalArea',
  'frontage',
  'depth',
  'floors',
  'creator',
  'status',
  'modifiedTime',
  'actions',
] as const;

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
  // The value behind a cell that states less on its face: the exact recorded instant, kept on the
  // cell so the precise moment is never lost to the phrase that replaced it.
  title?: string;
};

export type PropertyTableRow = {
  id: string;
  // What the row is called when it is read out: the property code, and the recorded address when
  // there is one.
  title: string;
  cells: TableCell[];
};

// The recorded facts the list states in its own columns and the quick view states as facts about
// the record: frontage, depth, floors and the colleagues who created and last modified it. Both
// surfaces render these strings, so a row and the panel opened from it cannot disagree, and a fact
// the record does not hold is the missing-value marker rather than a blank or a zero - an unknown
// frontage and a recorded frontage of zero are different facts, and a creator the summary cannot
// resolve is not the person who created it.
export type RecordedFact = { text: string; known: boolean };

export function recordFacts(
  record: Pick<
    PropertySummary,
    'frontageM' | 'depthM' | 'floors' | 'createdBy' | 'updatedBy'
  >,
  locale: Locale,
): {
  frontage: RecordedFact;
  depth: RecordedFact;
  floors: RecordedFact;
  creator: RecordedFact;
  modifier: RecordedFact;
} {
  // A measured length is exact text from the database, never a rounded number, and its unit rides
  // with it so the table cell and the panel read the same characters.
  const metres = (value: string | null | undefined): RecordedFact =>
    value === null || value === undefined
      ? { text: MISSING_VALUE, known: false }
      : { text: `${formatDecimal(value, locale)} m`, known: true };
  const counted = (value: number | null | undefined): RecordedFact =>
    value === null || value === undefined
      ? { text: MISSING_VALUE, known: false }
      : { text: formatInteger(value, locale), known: true };
  const creator = record.createdBy?.trim();
  const modifier = record.updatedBy?.trim();
  return {
    frontage: metres(record.frontageM),
    depth: metres(record.depthM),
    floors: counted(record.floors),
    creator: creator
      ? { text: creator, known: true }
      : { text: MISSING_VALUE, known: false },
    modifier: modifier
      ? { text: modifier, known: true }
      : { text: MISSING_VALUE, known: false },
  };
}

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

// The recorded address a listed property states: the address in the format the search reads
// through, so a row listed under a format shows that address rather than whichever recorded
// variant happens to be primary. A search that states no format, or a record with no address in
// the named format, states the recorded primary address.
export function listedAddress(
  record: PropertySummary,
  addressFormat: string | null = null,
): AddressSummary | undefined {
  return (
    record.addresses.find((address) => address.format === addressFormat) ??
    record.addresses[0]
  );
}

// One row of the table: every column, in the table's own order, with the value it holds or the
// missing-value marker. `now` is the browser's clock for the modified phrase, and null means the
// page has not hydrated yet: the cell then states the recorded timestamp itself.
export function propertyTableRow(
  record: PropertySummary,
  locale: Locale,
  now: number | null = null,
  addressFormat: string | null = null,
): PropertyTableRow {
  const text = messages[locale];
  const address = listedAddress(record, addressFormat) ?? null;
  const price = rowPrice(record);
  const area = totalAreaM2(record);
  const modified = relativeTime(record.updatedAt, locale, now);
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
      text: modified ? modified.text : MISSING_VALUE,
      ...(modified ? { title: modified.exact } : {}),
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
