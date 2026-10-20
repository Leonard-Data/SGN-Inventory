// The local address index: the catalogue's recorded addresses folded once per property, and the
// one match the address box runs while a person types. Folding is the accent-insensitive
// comparison the database's own address search already documents, kept here so a keystroke reads
// nothing at all. Ranking, abbreviation expansion, house-number structure and the rules that
// relate an old address to a current one belong to the matching slice (issue #191) and are
// deliberately not here.
import type { PropertySummary } from './types';

export type CatalogueAddressVariant = {
  // The recorded format the variant was stored in: legacy, current or alternate.
  format: string;
  // The recorded address text exactly as entered. Display reads this, never the folded form.
  addressText: string;
  folded: string;
};

export type CatalogueIndexEntry = {
  record: PropertySummary;
  variants: CatalogueAddressVariant[];
};

// What the address box filters locally: the text to match, or null when the box is not filtering the
// loaded catalogue at all. Typing is local and submitting the box is the server search, so a text
// the page is already showing is not re-filtered, and a chronological ordering or a filter set -
// which the loaded page cannot state - keeps the server search until the local-filter split is
// built (issue #194). An empty string is the whole loaded page, never an absence of filtering.
export function localAddressQuery(
  typed: string,
  shown: string,
  sort: string | null,
  filters: number,
): string | null {
  if (typed.trim() === shown.trim() || sort !== null || filters > 0)
    return null;
  return typed.trim();
}

// The comparison form of an address: case-folded, without accent marks, with đ read as d, and with
// repeated whitespace collapsed. House-number structure (12/5, 12A) survives untouched, and
// nothing is added to the text: an unrecorded new ward name is never inferred from an old one.
export function foldAddress(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('đ', 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

// The index is built once per loaded page rather than once per keystroke: every property's variants
// are folded here, and the record itself is kept so a result draws its recorded address text.
export function buildAddressIndex(
  records: readonly PropertySummary[],
): CatalogueIndexEntry[] {
  return records.map((record) => ({
    record,
    variants: record.addresses.map((address) => ({
      format: address.format,
      addressText: address.addressText,
      folded: foldAddress(address.addressText),
    })),
  }));
}

// The properties whose recorded address text matches what the person typed. Each stored variant is
// searched on its own, so a query can never match a mixture of an old district and a current ward,
// and a property matches when any one of its variants does. An empty query is the whole loaded
// page, never an empty result.
export function matchCatalogue(
  index: readonly CatalogueIndexEntry[],
  query: string,
): PropertySummary[] {
  const folded = foldAddress(query);
  if (!folded) return index.map((entry) => entry.record);
  return index
    .filter((entry) =>
      entry.variants.some((variant) => variant.folded.includes(folded)),
    )
    .map((entry) => entry.record);
}
