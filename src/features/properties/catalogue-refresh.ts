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

export type CatalogueRefreshFailure = {
  code: string;
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

export function acceptReplacementPage(
  generations: CatalogueGenerations,
  generationId: string,
  page: CataloguePage,
  syncedAt: string,
): CatalogueGenerations {
  const { staged } = generations;
  if (!refreshing(generations) || staged?.generationId !== generationId)
    return generations;
  return { ...generations, staged: indexCataloguePage(staged, page, syncedAt) };
}

export function commitReplacement(
  generations: CatalogueGenerations,
  generationId: string,
): CatalogueGenerations {
  const { staged } = generations;
  if (
    !refreshing(generations) ||
    staged?.generationId !== generationId ||
    !staged.isComplete
  )
    return generations;
  return { working: staged, staged: null, resumed: false, failure: null };
}

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
  if (
    code === 'access-denied' ||
    code === 'unauthenticated' ||
    code === 'access-changed'
  )
    return NO_GENERATIONS;
  return {
    ...generations,
    resumed: false,
    failure: { code },
  };
}

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
  | { status: 'failed'; loadedCount: number };

export function catalogueRefreshView(
  generations: CatalogueGenerations,
  count: CatalogueCount,
): CatalogueRefreshView {
  const { staged, failure } = generations;
  if (failure)
    return {
      status: 'failed',
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
