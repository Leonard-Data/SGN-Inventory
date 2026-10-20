// The deliberate refresh: a replacement catalogue built quietly beside the one the user is
// searching, swapped in only once its own traversal has finished. Nothing here reads or writes;
// it is the rule that decides which generation a response belongs to, when the working catalogue
// may be replaced, and what a stopped refresh leaves behind, so all of it is testable without a
// browser or a database. The read behind each page is `catalogue-cache.ts`; the decision behind
// the slice is issue #190.
import {
  catalogueProgress,
  indexCataloguePage,
  startCatalogueLoad,
  type CatalogueCount,
  type CatalogueLoadState,
} from './catalogue-load.ts';
import type { CataloguePage } from './types.ts';

// A replacement stopped before it could be swapped in. `resumable` states the two honest outcomes
// of Retry: the staged rows were kept, so it continues the same traversal from its own cursor, or
// they were discarded, so Retry starts a new generation with its progress reset.
export type CatalogueRefreshFailure = {
  code: string;
  resumable: boolean;
};

// The two catalogues one browser session holds. `working` is the catalogue the list searches and
// the address box filters; during a refresh it is still the previous complete one, untouched.
// `staged` is the replacement a refresh is building; it becomes the working catalogue only after
// its traversal has finished and every received row is indexed.
export type CatalogueGenerations = {
  working: CatalogueLoadState | null;
  staged: CatalogueLoadState | null;
  // Whether the staged replacement continued a stopped generation instead of starting over.
  resumed: boolean;
  failure: CatalogueRefreshFailure | null;
};

export const NO_GENERATIONS: CatalogueGenerations = {
  working: null,
  staged: null,
  resumed: false,
  failure: null,
};

// Whether a replacement is in flight. A staged replacement that already stopped is not running.
export function refreshing(generations: CatalogueGenerations): boolean {
  return generations.staged !== null && generations.failure === null;
}

// A newly authorized context: its arriving catalogue is the only working one, and nothing staged,
// held or failed for the former authority survives. Responses from that authority are superseded.
export function startWorking(generationId: string): CatalogueGenerations {
  return {
    working: startCatalogueLoad(generationId),
    staged: null,
    resumed: false,
    failure: null,
  };
}

// The state the working load just published. A read whose generation is no longer the working one
// is superseded - a late response from the former authority - and changes nothing.
export function acceptWorking(
  generations: CatalogueGenerations,
  working: CatalogueLoadState,
): CatalogueGenerations {
  if (generations.working?.generationId !== working.generationId)
    return generations;
  return { ...generations, working };
}

// Begin the deliberate replacement. A second start while one is running, or a refresh of a
// catalogue the user does not have yet, changes nothing: overlapping loads are what this refuses.
// `resume` continues a stopped generation's own cursor and keeps its rows; otherwise a new
// generation starts and its progress resets to nothing loaded.
export function beginRefresh(
  generations: CatalogueGenerations,
  generationId: string,
  resume: CatalogueLoadState | null = null,
): CatalogueGenerations {
  if (generations.working?.isComplete !== true || refreshing(generations))
    return generations;
  return {
    ...generations,
    staged: resume ?? startCatalogueLoad(generationId),
    resumed: resume !== null,
    failure: null,
  };
}

// Fold one received replacement batch. The batch that ends the traversal swaps the replacement in:
// every cursor has been traversed and every received row is indexed, so records that were deleted
// or became inaccessible are gone with the catalogue they were in. A batch from a generation that
// is not the running one changes nothing.
export function acceptReplacementPage(
  generations: CatalogueGenerations,
  generationId: string,
  page: CataloguePage,
  syncedAt: string,
): CatalogueGenerations {
  const { staged } = generations;
  if (!refreshing(generations) || staged?.generationId !== generationId)
    return generations;
  const indexed = indexCataloguePage(staged, page, syncedAt);
  return indexed.isComplete
    ? { working: indexed, staged: null, resumed: false, failure: null }
    : { ...generations, staged: indexed };
}

// The replacement stopped. A failure whose authority is intact keeps the staged rows, so Retry
// continues the same traversal from its own cursor; one that ends the authority discards them, so
// Retry starts over. Either way the working catalogue and its synchronization time are never
// touched, and a failure reported for a generation that is not the running one changes nothing.
export function failReplacement(
  generations: CatalogueGenerations,
  generationId: string,
  code: string,
): CatalogueGenerations {
  if (
    !refreshing(generations) ||
    generations.staged?.generationId !== generationId
  )
    return generations;
  const resumable = refreshResumes(code);
  return {
    ...generations,
    staged: resumable ? generations.staged : null,
    resumed: false,
    failure: { code, resumable },
  };
}

// Whether a stopped replacement may continue from its own cursor. An authorization refusal ends
// that traversal's authority, so its staged rows are discarded rather than resumed; every other
// failure keeps them, and Retry continues instead of reading the whole inventory again.
export function refreshResumes(code: string): boolean {
  return code !== 'access-denied';
}

// What the refresh line states, kept separate from the working catalogue's own progress. A
// refreshing state describes the replacement being loaded - never the catalogue the user is
// searching, and never as a completed load, which a staged replacement cannot be: the batch that
// finishes it is swapped in on arrival. A failed state states how much was loaded and which of the
// two things Retry will do.
export type CatalogueRefreshView =
  | { status: 'idle' }
  | {
      status: 'refreshing';
      resumed: boolean;
      loadedCount: number;
      // Stated only alongside a determinate percentage: an unknown, failed or still-zero authorized
      // total leaves the replacement's progress indeterminate rather than dividing by nothing.
      totalCount: number | null;
      progressPercent: number | null;
    }
  | { status: 'failed'; resumable: boolean; loadedCount: number };

export function catalogueRefreshView(
  generations: CatalogueGenerations,
  count: CatalogueCount,
): CatalogueRefreshView {
  const { staged, failure } = generations;
  if (failure)
    return {
      status: 'failed',
      resumable: failure.resumable,
      loadedCount: staged?.loadedCount ?? 0,
    };
  if (!staged) return { status: 'idle' };
  const { loadedCount, totalCount, progressPercent } = catalogueProgress(
    staged,
    count,
  );
  return {
    status: 'refreshing',
    resumed: generations.resumed,
    loadedCount,
    totalCount: progressPercent === null ? null : totalCount,
    progressPercent,
  };
}
