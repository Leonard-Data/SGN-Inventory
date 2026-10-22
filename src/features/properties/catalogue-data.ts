import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import {
  CATALOGUE_PAGE_SIZE,
  CATALOGUE_SELECT,
  catalogueFailure,
  catalogueKeyset,
  catalogueSummary,
  nextCatalogueCursor,
  type CatalogueCursor,
  type CatalogueRow,
} from './catalogue';
import { propertyCreators, propertyModifiers } from './creator';
import type { CataloguePage, PropertySummary } from './types';

// One page of the browser catalogue: the caller's own authorized, unarchived inventory in one
// stable total order - the record's own modification time, then its identity - with each
// property's address variants flattened into its row. It is the order the inventory list's own
// browse states, so the first page painted here is the inventory's first window.
//
// The cursor names the position the page starts after and nothing else. The read runs on the
// caller's own session client, so row level security is what decides which rows exist for them at
// all, and it is reapplied on every page: a cursor can never reach a row the caller may not read.
export async function cataloguePage(
  context: RouteContext,
  after: CatalogueCursor | null,
): Promise<CataloguePage> {
  const read = context.client
    .from('properties')
    .select(CATALOGUE_SELECT)
    // The ordinary inventory boundary: an archived record is not part of the browsing catalogue,
    // exactly as the list's own stream excludes it.
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(CATALOGUE_PAGE_SIZE);
  const { data, error } = await (after === null
    ? read
    : read.or(catalogueKeyset(after)));
  if (error) {
    const failure = catalogueFailure(error.code);
    throw new ApiError(failure.status, failure.code);
  }
  const rows = (data ?? []) as unknown as CatalogueRow[];
  const attribution = await catalogueAttribution(context, rows);
  return {
    properties: rows.map((row) =>
      catalogueSummary(
        row,
        attribution.creators.get(row.id) ?? null,
        attribution.modifiers.get(row.id) ?? null,
      ),
    ),
    nextCursor: nextCatalogueCursor(
      rows.map((row) => ({ id: row.id, updatedAt: row.updated_at })),
    ),
  };
}

// The creator's and the modifier's display names for the page just read: one names read for the
// page's distinct references through the sanctioned employee-name projection, so no colleague's
// employee row has to be readable. A reference that does not resolve contributes no name, exactly
// as the stream's own attribution states it.
async function catalogueAttribution(
  context: RouteContext,
  rows: readonly CatalogueRow[],
): Promise<{
  creators: Map<string, string>;
  modifiers: Map<string, string>;
}> {
  const ids = [
    ...new Set(
      rows.flatMap((row) =>
        [row.created_by, row.updated_by].flatMap((id) => (id ? [id] : [])),
      ),
    ),
  ];
  if (!ids.length) return { creators: new Map(), modifiers: new Map() };
  const { data, error } = await context.client.rpc('list_employee_names', {
    p_ids: ids,
  });
  if (error) {
    const failure = catalogueFailure(error.code);
    throw new ApiError(failure.status, failure.code);
  }
  return {
    creators: propertyCreators(rows, data ?? []),
    modifiers: propertyModifiers(rows, data ?? []),
  };
}

// The authorized total of the same inventory the pages above carry, read once per load generation.
// It is an ordinary row count under the caller's own authorization and the same eligibility, so a
// total can never describe rows the pages may not receive. It states how much there is to load and
// never decides where the traversal stops, so it may arrive late, or fail, without blocking a page.
export async function catalogueTotal(context: RouteContext): Promise<number> {
  const { count, error } = await context.client
    .from('properties')
    .select('id', { count: 'exact', head: true })
    .is('archived_at', null);
  if (error) {
    const failure = catalogueFailure(error.code);
    throw new ApiError(failure.status, failure.code);
  }
  return count ?? 0;
}

// The authoritative summary of one property, as the catalogue states it, read on the caller's own
// session client after a change committed. It is the same select, projection, unarchived
// eligibility and authorization as a catalogue page, so a mutation response can never carry a
// summary the catalogue would not answer with.
//
// null is the server's own answer that the property is no longer in this caller's catalogue
// (archived, deleted or no longer readable), and undefined is a summary that could not be read
// back at all: the browser then reads the catalogue again rather than keeping a row nothing
// confirms.
export async function catalogueSummaryOf(
  context: RouteContext,
  id: string,
): Promise<PropertySummary | null | undefined> {
  const { data, error } = await context.client
    .from('properties')
    .select(CATALOGUE_SELECT)
    .eq('id', id)
    .is('archived_at', null)
    .maybeSingle();
  if (error) return undefined;
  if (!data) return null;
  const row = data as unknown as CatalogueRow;
  // The same attribution the page read states: one names read for this row's creator and modifier,
  // so a summary committed by a change keeps showing who created and who last edited the property.
  const attribution = await catalogueAttribution(context, [row]);
  return catalogueSummary(
    row,
    attribution.creators.get(row.id) ?? null,
    attribution.modifiers.get(row.id) ?? null,
  );
}
