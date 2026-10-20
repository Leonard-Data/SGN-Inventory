import { hashKey, type QueryClient } from '@tanstack/react-query';
import { api } from '../employees/api.ts';
import { renderedSession } from '../employees/protected-load.ts';
import type { EmployeeSession } from '../employees/types';
import { CATALOGUE_SCHEMA_VERSION } from './catalogue.ts';
import {
  indexCataloguePage,
  readEveryCataloguePage,
  startCatalogueLoad,
  type CatalogueLoadState,
} from './catalogue-load.ts';
import type { CataloguePage } from './types';

export type ScopedCatalogue = {
  scope: EmployeeSession;
  load: CatalogueLoadState;
};

// The catalogue read's own address: one bounded page after the cursor, and nothing else. The
// cursor is a position in the identity ordering, never a grant of access to the rows it names.
function cataloguePageUrl(after: string | null) {
  return after === null
    ? '/api/properties/catalogue'
    : `/api/properties/catalogue?after=${encodeURIComponent(after)}`;
}

export type CatalogueLoadOptions = {
  // Every indexed batch is published as it is committed, so the first page is searchable before
  // the traversal finishes and before the authorized total arrives.
  publish: (state: CatalogueLoadState) => void;
  generationId: string;
  // The state an interrupted generation reached, so Retry continues from the cursor it stopped at
  // instead of reading the whole traversal again. A new generation passes null.
  resume?: CatalogueLoadState | null;
  now?: () => string;
};

// One catalogue load generation, walked to the end through the scoped query cache the browser
// already owns (#188). The traversal is sequential so database pressure stays bounded, and every
// received page is deduplicated and indexed as it arrives. An aborted read stops where it is and
// leaves the rows already indexed in place; the caller resumes from the state it holds.
export async function readCatalogue(
  client: QueryClient,
  signal: AbortSignal,
  scope: EmployeeSession,
  options: CatalogueLoadOptions,
): Promise<ScopedCatalogue> {
  const queryKey = [
    'property-catalogue',
    renderedSession(scope.employee),
    scope.accessRevision,
    CATALOGUE_SCHEMA_VERSION,
  ];
  client.removeQueries({
    queryKey: ['property-catalogue'],
    predicate: (query) => query.queryHash !== hashKey(queryKey),
  });
  const now = options.now ?? (() => new Date().toISOString());
  const load = await client.fetchQuery({
    queryKey,
    queryFn: ({ signal: querySignal }) => {
      const readSignal = AbortSignal.any([signal, querySignal]);
      let state = options.resume ?? startCatalogueLoad(options.generationId);
      if (!options.resume) options.publish(state);
      return readEveryCataloguePage({
        read: (after, pageSignal) =>
          api<CataloguePage>(cataloguePageUrl(after), undefined, pageSignal),
        from: state.nextCursor,
        signal: readSignal,
        onPage: (page) => {
          state = indexCataloguePage(state, page, now());
          options.publish(state);
        },
      }).then(() => state);
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
  // A traversal the browser already finished and cached publishes nothing while it is read back,
  // so the state a freshly mounted loader reads is the one that was cached.
  options.publish(load);
  return { scope, load };
}
