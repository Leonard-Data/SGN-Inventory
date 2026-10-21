// The property catalogue's progressive load: one generation that walks the endpoint's cursor to
// the end, deduplicates by property identity, indexes every batch as it arrives and states
// honestly how complete it is. Everything here is arithmetic and wording over values the browser
// already holds, so the traversal, the deduplication, the completion rule and the percentage are
// testable without a browser or a database. The read behind each page is `catalogue-cache.ts`;
// the decision behind the slice is ADR 0003 and issue #189.
import {
  buildAddressIndex,
  type CatalogueIndexEntry,
} from './address-index.ts';
import type { CataloguePage } from './types';

// The highest percentage a load that has not finished may state. The authorized count and the
// batch traversal can observe different live database states, so a percentage is approximate by
// nature: 100% belongs only to a finished traversal whose every received row is already indexed.
export const CATALOGUE_INCOMPLETE_PERCENT = 99;

// The authorized total as the browser holds it: one independent request per load generation that
// may arrive late, or fail, without ever deciding where the traversal stops.
export type CatalogueCount = {
  total: number | null;
  capturedAt: string | null;
};

// The structured state of one load generation, in the shape the specification states it. It is a
// browsing aid only: a lock, an approval or an edit always validates against current server state.
export type CatalogueProgress = {
  generationId: string;
  // Unique properties committed to the searchable index.
  loadedCount: number;
  // The authorized total when one arrived and could be trusted, otherwise null.
  totalCount: number | null;
  countCapturedAt: string | null;
  isComplete: boolean;
  progressPercent: number | null;
  // Set once the traversal finished and every received row was indexed.
  lastSyncedAt: string | null;
};

export type CatalogueLoadState = {
  generationId: string;
  loadedCount: number;
  isComplete: boolean;
  lastSyncedAt: string | null;
  // Where a retry resumes: the cursor after the last indexed batch, or null to read from the first
  // page. A retried or duplicated page therefore adds nothing a second time.
  nextCursor: string | null;
  // The properties indexed so far, deduplicated and in first-seen order, with the address index
  // built from them incrementally as batches arrive rather than rebuilt per batch.
  index: readonly CatalogueIndexEntry[];
};

export function startCatalogueLoad(generationId: string): CatalogueLoadState {
  return {
    generationId,
    loadedCount: 0,
    isComplete: false,
    lastSyncedAt: null,
    nextCursor: null,
    index: [],
  };
}

// The percentage a progressive load may state, or null when it cannot state one at all. A zero
// total with loading still active stays indeterminate rather than dividing by zero, and an unknown
// or failed total states no percentage instead of inventing one.
export function cataloguePercent(
  loadedCount: number,
  totalCount: number | null,
  isComplete: boolean,
): number | null {
  if (totalCount === null) return null;
  if (isComplete) return 100;
  if (totalCount <= 0) return null;
  return Math.min(
    CATALOGUE_INCOMPLETE_PERCENT,
    Math.floor((loadedCount / totalCount) * 100),
  );
}

// Fold one received page into the load. A property whose identity is already indexed adds nothing,
// so a retried or duplicated row never inflates the count, and the load is marked complete only
// after this page's new rows are indexed - never merely because a cursor looked like the last one.
export function indexCataloguePage(
  state: CatalogueLoadState,
  page: CataloguePage,
  syncedAt: string,
): CatalogueLoadState {
  const seen = new Set(state.index.map((entry) => entry.record.id));
  const added: typeof page.properties = [];
  for (const record of page.properties) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    added.push(record);
  }
  const isComplete = page.nextCursor === null;
  return {
    generationId: state.generationId,
    loadedCount: state.loadedCount + added.length,
    isComplete,
    lastSyncedAt: isComplete ? syncedAt : state.lastSyncedAt,
    nextCursor: page.nextCursor,
    index:
      added.length === 0
        ? state.index
        : [...state.index, ...buildAddressIndex(added)],
  };
}

// The structured progress a consumer sees: the load's own state with the authorized count folded
// in, so a count that arrives before, during or after the batches never changes them.
export function catalogueProgress(
  state: CatalogueLoadState,
  count: CatalogueCount,
): CatalogueProgress {
  return {
    generationId: state.generationId,
    loadedCount: state.loadedCount,
    totalCount: count.total,
    countCapturedAt: count.capturedAt,
    isComplete: state.isComplete,
    progressPercent: cataloguePercent(
      state.loadedCount,
      count.total,
      state.isComplete,
    ),
    lastSyncedAt: state.lastSyncedAt,
  };
}

export type CataloguePageReader = (
  after: string | null,
  signal: AbortSignal,
) => Promise<CataloguePage>;

// Walk every cursor to the end, one batch at a time, handing each received page back for indexing.
// The batches stay sequential so database pressure is bounded, and an aborted read stops the
// traversal where it is without discarding what earlier batches already indexed.
export async function readEveryCataloguePage(options: {
  read: CataloguePageReader;
  from: string | null;
  signal: AbortSignal;
  onPage: (page: CataloguePage) => void;
}): Promise<void> {
  let after = options.from;
  for (;;) {
    options.signal.throwIfAborted();
    const page = await options.read(after, options.signal);
    options.signal.throwIfAborted();
    options.onPage(page);
    if (page.nextCursor === null) return;
    after = page.nextCursor;
  }
}

// What the progress indicator states. A total that is unknown, failed or still zero states the
// loaded count alone; only a determinate percentage carries a number.
export type CatalogueProgressView =
  | { kind: 'loading-known'; loaded: number; total: number; percent: number }
  | { kind: 'loading-unknown'; loaded: number }
  | { kind: 'incomplete'; loaded: number }
  | { kind: 'complete'; loaded: number };

export function catalogueProgressView(
  progress: CatalogueProgress,
  failed: boolean,
): CatalogueProgressView {
  if (progress.isComplete)
    return { kind: 'complete', loaded: progress.loadedCount };
  if (failed) return { kind: 'incomplete', loaded: progress.loadedCount };
  const { totalCount, progressPercent } = progress;
  // A zero total with loading still active is indeterminate: there is nothing yet to divide by
  // and nothing to claim about an inventory the traversal has not finished reading.
  return totalCount !== null && totalCount > 0 && progressPercent !== null
    ? {
        kind: 'loading-known',
        loaded: progress.loadedCount,
        total: totalCount,
        percent: progressPercent,
      }
    : { kind: 'loading-unknown', loaded: progress.loadedCount };
}

// Where an empty result area may draw its answer from, and which wording that earns. A result the
// browser answered from the catalogue it holds can only say that nothing in the loaded properties
// matched: while the catalogue is incomplete that is never the whole inventory, and even a
// complete catalogue states the loaded properties it actually searched.
export type EmptyResultSource =
  | {
      from: 'catalogue';
      loaded: boolean;
      complete: boolean;
      failed: boolean;
      // Whether the list is narrowed to the reader's own records: that empty state says something
      // about the reader's work rather than about the inventory, so it gets its own wording.
      createdByMine?: boolean;
    }
  | { from: 'inventory'; filterCount: number };

export type EmptyResultWording =
  | 'catalogue-no-matches'
  | 'catalogue-none-created'
  | 'catalogue-failed'
  | 'catalogue-loading'
  | 'filtered'
  | 'inventory';

export function emptyResultWording(
  source: EmptyResultSource,
): EmptyResultWording {
  if (source.from === 'inventory')
    return source.filterCount > 0 ? 'filtered' : 'inventory';
  // A completed catalogue that indexed nothing has answered for the whole inventory it may read,
  // so its empty result is definitive for that scope rather than a load still in progress.
  if (source.loaded || source.complete)
    return source.createdByMine
      ? 'catalogue-none-created'
      : 'catalogue-no-matches';
  return source.failed ? 'catalogue-failed' : 'catalogue-loading';
}
