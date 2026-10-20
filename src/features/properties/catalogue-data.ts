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
  return {
    properties: rows.map(catalogueSummary),
    nextCursor: nextCatalogueCursor(rows.map((row) => row.id)),
  };
}
