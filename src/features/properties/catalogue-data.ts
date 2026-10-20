import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import {
  CATALOGUE_PAGE_SIZE,
  CATALOGUE_SELECT,
  catalogueFailure,
  catalogueSummary,
  nextCatalogueCursor,
  type CatalogueRow,
} from './catalogue';
import { propertyCreators } from './creator';
import type { CataloguePage } from './types';

// One page of the browser catalogue: the caller's own authorized, unarchived inventory in one
// stable identity order, with each property's address variants flattened into its row.
//
// The cursor names the position the page starts after and nothing else. The read runs on the
// caller's own session client, so row level security is what decides which rows exist for them at
// all, and it is reapplied on every page: a cursor can never reach a row the caller may not read.
export async function cataloguePage(
  context: RouteContext,
  after: string | null,
): Promise<CataloguePage> {
  const read = context.client
    .from('properties')
    .select(CATALOGUE_SELECT)
    // The ordinary inventory boundary: an archived record is not part of the browsing catalogue,
    // exactly as the list's own stream excludes it.
    .is('archived_at', null)
    .order('id', { ascending: true })
    .limit(CATALOGUE_PAGE_SIZE);
  const { data, error } = await (after === null ? read : read.gt('id', after));
  if (error) {
    const failure = catalogueFailure(error.code);
    throw new ApiError(failure.status, failure.code);
  }
  const rows = (data ?? []) as unknown as CatalogueRow[];
  const creators = await catalogueCreators(context, rows);
  return {
    properties: rows.map((row) =>
      catalogueSummary(row, creators.get(row.id) ?? null),
    ),
    nextCursor: nextCatalogueCursor(rows.map((row) => row.id)),
  };
}

// The creator's display name for the page just read: one names read for the page's distinct
// creators through the sanctioned employee-name projection, so no colleague's employee row has to
// be readable. A creator that does not resolve contributes no name, exactly as the stream's own
// attribution states it.
async function catalogueCreators(
  context: RouteContext,
  rows: readonly CatalogueRow[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(rows.flatMap((row) => (row.created_by ? [row.created_by] : []))),
  ];
  if (!ids.length) return new Map();
  const { data, error } = await context.client.rpc('list_employee_names', {
    p_ids: ids,
  });
  if (error) {
    const failure = catalogueFailure(error.code);
    throw new ApiError(failure.status, failure.code);
  }
  return propertyCreators(rows, data ?? []);
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
