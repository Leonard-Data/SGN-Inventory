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
export const CATALOGUE_SCHEMA_VERSION = 2;

// The one field list a catalogue read carries. Money and measurements are cast to text, so a
// whole-VND or m² value is never rounded through a JavaScript number, and a property's address
// variants ride on the same row: the browser never fetches related records per result. Contacts,
// legal fields, notes and the entry chronology are deliberately absent - they belong to detail and
// chronological reads. The creator reference rides along so the ordinary browse keeps its
// attribution; the display name is resolved through the sanctioned employee-name projection.
export const CATALOGUE_SELECT =
  'id,property_code,listing_mode,status,property_type,' +
  'sale_price_vnd::text,monthly_rent_vnd::text,' +
  'land_area_m2::text,floor_area_m2::text,frontage_m::text,depth_m::text,floors,' +
  'direction,access_type,cover_file_id,created_at,updated_at,created_by,' +
  'property_addresses(id,format,address_text,house_number,street,commune_text,district_text,' +
  'is_primary,mapping_status,supersedes_address_id)';

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
  };
}

// The summary one catalogue row states, in the list's own record shape so the list, the quick view
// and the local address index read the same record they read from the stream. The creator is the
// display name the page resolved for this row; the entry chronology is not part of the catalogue,
// because it belongs to the chronological views.
export function catalogueSummary(
  row: CatalogueRow,
  createdBy: string | null,
): PropertySummary {
  const versions = row.property_addresses ?? [];
  // A version another version replaced is superseded history, so it is not folded into the summary
  // and the address index never matches the address a property moved from.
  const superseded = new Set(
    versions.flatMap((address) =>
      address.supersedes_address_id ? [address.supersedes_address_id] : [],
    ),
  );
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
  };
}

// The catalogue's cursor is a row position in one stable ordering - the property identity - and
// never an authorization grant: every read reapplies the caller's own authorization and answers
// with the rows that identity may receive, whatever cursor it was handed.
export function parseCatalogueCursor(
  params: URLSearchParams,
): { ok: true; after: string | null } | { ok: false } {
  const after = params.get('after');
  if (after === null) return { ok: true, after: null };
  return isUuid(after) ? { ok: true, after } : { ok: false };
}

// The one request a catalogue read answers: no cursor is the first page, a property identity is a
// position in the traversal, and anything else in the address - a filter, a page number, a
// mangled cursor - is refused rather than answered with a page the caller did not ask for.
export function catalogueRequest(
  params: URLSearchParams,
): { ok: true; after: string | null } | { ok: false } {
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

// The cursor the page after this one starts after: the last identity this page carried, or null
// when this page ended the traversal. A full page may still be the last one, so the following read
// decides rather than this one.
export function nextCatalogueCursor(ids: readonly string[]): string | null {
  return ids.length >= CATALOGUE_PAGE_SIZE
    ? (ids[ids.length - 1] ?? null)
    : null;
}
