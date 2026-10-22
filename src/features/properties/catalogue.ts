// The browser catalogue's own contract: the summary fields one catalogue read may carry, the
// stable cursor that walks the authorized inventory, and the projection from a read row to the
// summary the list draws. Everything here is shaping and arithmetic over values, so the page
// length, the cursor and the projection are testable without a database or a browser. The read
// that uses them is `catalogue-data.ts`; the decision behind it is ADR 0003.
import { isUuid } from '../../lib/supabase/query.ts';
import type { AddressSummary, PropertySummary } from './types';

// Rows per catalogue read. The specification's starting point for the first batch is 100 to 200
// summaries; the read states its own bound, so a page stays a bounded payload whatever a caller
// asks for.
export const CATALOGUE_PAGE_SIZE = 200;

// The summary shape's own version. A browser-held catalogue is only reused for the same shape, so
// a later field change starts a new key instead of reading rows of the old one as the new one.
// Version 6 is the most-recently-changed browse order: a catalogue read before it is in another
// order and is not reused.
export const CATALOGUE_SCHEMA_VERSION = 6;

// The one field list a catalogue read carries. Money and measurements are cast to text, so a
// whole-VND or m² value is never rounded through a JavaScript number, and a property's address
// variants ride on the same row: the browser never fetches related records per result. Contacts,
// legal fields, notes and the entry chronology are deliberately absent - they belong to detail and
// chronological reads. The creator and modifier references ride along so the ordinary browse keeps
// its attribution; the display names are resolved through the sanctioned employee-name projection.
export const CATALOGUE_SELECT =
  'id,property_code,listing_mode,status,property_type,' +
  'sale_price_vnd::text,monthly_rent_vnd::text,' +
  'land_area_m2::text,floor_area_m2::text,frontage_m::text,depth_m::text,floors,' +
  'direction,access_type,cover_file_id,created_at,updated_at,created_by,updated_by,' +
  'property_addresses(id,format,address_text,house_number,street,commune_text,district_text,' +
  'is_primary,mapping_status,supersedes_address_id,' +
  // The official names the address chose, read through their own ids, so a unit picked from a list
  // is matched by its official name even when the recorded text never spells it.
  'province:admin_unit_versions!province_unit_id(name_vi),' +
  'district:admin_unit_versions!district_unit_id(name_vi),' +
  'commune:admin_unit_versions!commune_unit_id(name_vi))';

// One row of the catalogue read, as that read's own select list shapes it: the summary fields with
// the property's address variants flattened into the row.
export type CatalogueAddressRow = {
  id: string;
  format: string;
  address_text: string;
  house_number: string | null;
  street: string | null;
  commune_text: string | null;
  district_text: string | null;
  is_primary: boolean;
  mapping_status: string;
  // The official unit this address recorded at each level, when it recorded one.
  province: { name_vi: string } | null;
  district: { name_vi: string } | null;
  commune: { name_vi: string } | null;
  // The version of this property's address this row replaced: a row another row names here is
  // history the database keeps, not part of the address the property is recorded at now.
  supersedes_address_id: string | null;
};

export type CatalogueRow = {
  id: string;
  property_code: string;
  listing_mode: string;
  status: string;
  property_type: string;
  sale_price_vnd: string | null;
  monthly_rent_vnd: string | null;
  land_area_m2: string | null;
  floor_area_m2: string | null;
  frontage_m: string | null;
  depth_m: string | null;
  floors: number | null;
  direction: string | null;
  access_type: string | null;
  cover_file_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  property_addresses: CatalogueAddressRow[] | null;
};

// The recorded address the catalogue states, in the shape the list already reads.
function catalogueAddress(row: CatalogueAddressRow): AddressSummary {
  return {
    id: row.id,
    format: row.format,
    // The recorded text exactly as entered: display never reads a folded or rebuilt address.
    addressText: row.address_text,
    mappingStatus: row.mapping_status,
    isPrimary: row.is_primary,
    houseNumber: row.house_number,
    street: row.street,
    commune: row.commune_text,
    district: row.district_text,
    // Largest tier first, and a level the address did not record contributes nothing: the names
    // are the recorded choice, never rebuilt from the text.
    units: [
      row.province?.name_vi,
      row.district?.name_vi,
      row.commune?.name_vi,
    ].filter((name): name is string => Boolean(name)),
  };
}

// A version another version replaced is superseded history, so it is not folded into the summary
// and the address index never matches the address a property moved from. Only a successor of the
// same format replaces: a legacy row corrected into another legacy row, or a current row into
// another current one. A current address recorded from a legacy one states the same property in
// today's geography and leaves the legacy row it came from in place.
export function supersededAddressIds(
  versions: readonly {
    id: string;
    format: string;
    supersedes_address_id: string | null;
  }[],
): Set<string> {
  const formats = new Map(
    versions.map((address): [string, string] => [address.id, address.format]),
  );
  return new Set(
    versions.flatMap((address) =>
      address.supersedes_address_id &&
      formats.get(address.supersedes_address_id) === address.format
        ? [address.supersedes_address_id]
        : [],
    ),
  );
}

// The summary one catalogue row states, in the list's own record shape so the list, the quick view
// and the local address index read the same record they read from the stream. The creator and
// modifier are the display names the page resolved for this row; the entry chronology is not part
// of the catalogue, because it belongs to the chronological views.
export function catalogueSummary(
  row: CatalogueRow,
  createdBy: string | null,
  modifiedBy: string | null = null,
): PropertySummary {
  const versions = row.property_addresses ?? [];
  const superseded = supersededAddressIds(versions);
  return {
    id: row.id,
    propertyCode: row.property_code,
    listingMode: row.listing_mode,
    status: row.status,
    propertyType: row.property_type,
    salePriceVnd: row.sale_price_vnd ?? null,
    monthlyRentVnd: row.monthly_rent_vnd ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    // Primary first, then identity: the card draws the first address, and the order is the one the
    // stream's own address read states. Both stored formats are carried; neither is rewritten from
    // the other.
    addresses: versions
      .filter((address) => !superseded.has(address.id))
      .sort((left, right) =>
        left.is_primary === right.is_primary
          ? left.id < right.id
            ? -1
            : 1
          : left.is_primary
            ? -1
            : 1,
      )
      .map(catalogueAddress),
    coverFileId: row.cover_file_id ?? null,
    frontageM: row.frontage_m ?? null,
    depthM: row.depth_m ?? null,
    landAreaM2: row.land_area_m2 ?? null,
    floorAreaM2: row.floor_area_m2 ?? null,
    floors: row.floors ?? null,
    direction: row.direction ?? null,
    accessType: row.access_type ?? null,
    createdBy,
    // The modifier's display name, resolved beside the creator's from the same names read.
    updatedBy: modifiedBy,
    // The creator's own identity, which the row already carries: the list's "created by me"
    // selection compares this rather than the display name, which two colleagues can share.
    createdById: row.created_by ?? null,
  };
}

// The catalogue's cursor is a row position in one total order - the record's own modification
// time, then the property identity - and never an authorization grant: every read reapplies the
// caller's own authorization and answers with the rows that position may receive, whatever cursor
// it was handed. The modification time is carried as the read stated it, never through a
// JavaScript Date, so two records sharing one instant are not rounded apart.
export type CatalogueCursor = { updatedAt: string; id: string };

const CURSOR_SEPARATOR = '|';

export function parseCatalogueCursor(
  params: URLSearchParams,
): { ok: true; after: CatalogueCursor | null } | { ok: false } {
  const after = params.get('after');
  if (after === null) return { ok: true, after: null };
  const [updatedAt = '', id = '', ...rest] = after.split(CURSOR_SEPARATOR);
  return rest.length === 0 && isUuid(id) && !Number.isNaN(Date.parse(updatedAt))
    ? { ok: true, after: { updatedAt, id } }
    : { ok: false };
}

// The read's own keyset for a position: every row strictly after this one in the same order - an
// earlier change time, or the same instant with a lower identity. Both terms repeat the value the
// read returned, quoted, so one date is read as one date rather than as more of the filter's own
// grammar.
export function catalogueKeyset(cursor: CatalogueCursor): string {
  const at = `"${cursor.updatedAt}"`;
  return `updated_at.lt.${at},and(updated_at.eq.${at},id.lt."${cursor.id}")`;
}

// The one request a catalogue read answers: no cursor is the first page, a property identity is a
// position in the traversal, and anything else in the address - a filter, a page number, a
// mangled cursor - is refused rather than answered with a page the caller did not ask for.
export function catalogueRequest(
  params: URLSearchParams,
): { ok: true; after: CatalogueCursor | null } | { ok: false } {
  if ([...params.keys()].some((key) => key !== 'after')) return { ok: false };
  return parseCatalogueCursor(params);
}

// The refusal one failed catalogue read answers. A permission error is a refusal and anything else
// is unavailable; neither is ever answered as an empty catalogue, which would read as an inventory
// that happens to hold no properties.
export function catalogueFailure(code: string | undefined): {
  status: number;
  code: string;
} {
  return code === '42501'
    ? { status: 403, code: 'access-denied' }
    : { status: 503, code: 'unavailable' };
}

// The cursor the page after this one starts after: the last position this page carried, or null
// when this page ended the traversal. A full page may still be the last one, so the following read
// decides rather than this one.
export function nextCatalogueCursor(
  rows: readonly { id: string; updatedAt: string | null }[],
): string | null {
  const last = rows[rows.length - 1];
  // A record whose change time the read did not state cannot state a position after it; the column
  // is not null in the database, so this ends the traversal only where nothing follows to skip.
  if (rows.length < CATALOGUE_PAGE_SIZE || !last || last.updatedAt === null)
    return null;
  return `${last.updatedAt}${CURSOR_SEPARATOR}${last.id}`;
}
