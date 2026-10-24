// Which columns of the table the person chose to see. Hiding is stated as the columns that are
// hidden, so the ordinary address - every column shown - stays short, and the choice travels in
// the address beside the view and the ordering, through the page's parameter list, so a reload or
// a shared link keeps it.
//
// The property code is never hidden: it names the record and opens its quick view, so a table
// without it is not the list this page shows.
import { SUMMARY_TABLE_COLUMNS, type SummaryColumn } from './table.ts';

export const HIDE_PARAM = 'hide';

// The one column a row cannot be read without.
export const FIXED_COLUMNS: readonly SummaryColumn[] = ['property'];

export const HIDEABLE_COLUMNS: readonly SummaryColumn[] =
  SUMMARY_TABLE_COLUMNS.filter((column) => !FIXED_COLUMNS.includes(column));

// The hidden columns an address states. A name this table does not have, and a column that can
// never be hidden, are not hidden columns: they are left out rather than served as a table with a
// different shape than the address names.
export function hiddenColumns(
  value: string | null | undefined,
): ReadonlySet<SummaryColumn> {
  const stated = new Set(
    (value ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => HIDEABLE_COLUMNS.includes(name as SummaryColumn)),
  );
  return stated as ReadonlySet<SummaryColumn>;
}

// The columns the table draws, in the table's own order.
export function shownColumns(
  hidden: ReadonlySet<SummaryColumn>,
): readonly SummaryColumn[] {
  return SUMMARY_TABLE_COLUMNS.filter((column) => !hidden.has(column));
}

// One checkbox: the column toggles, unless it is the one that is always shown.
export function toggleColumn(
  hidden: ReadonlySet<SummaryColumn>,
  column: SummaryColumn,
): ReadonlySet<SummaryColumn> {
  const next = new Set(hidden);
  if (next.has(column)) next.delete(column);
  else if (HIDEABLE_COLUMNS.includes(column)) next.add(column);
  return next;
}

// The visible columns as the address states them, in the table's own order so one choice has one
// address, or null when nothing is hidden.
export function hideParam(hidden: ReadonlySet<SummaryColumn>): string | null {
  const stated = SUMMARY_TABLE_COLUMNS.filter((column) => hidden.has(column));
  return stated.length ? stated.join(',') : null;
}
