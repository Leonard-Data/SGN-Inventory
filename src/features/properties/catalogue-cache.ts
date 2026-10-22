import { hashKey, queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, RequestError } from '../employees/api.ts';
import {
  AccessChangedError,
  loadProtected,
  renderedSession,
} from '../employees/protected-load.ts';
import type { EmployeeSession } from '../employees/types';
import { CATALOGUE_SCHEMA_VERSION } from './catalogue.ts';
import {
  indexCataloguePage,
  readEveryCataloguePage,
  startCatalogueLoad,
  type CatalogueCount,
  type CatalogueLoadState,
} from './catalogue-load.ts';
import type { CataloguePage } from './types';

export type ScopedCatalogue = {
  scope: EmployeeSession;
  load: CatalogueLoadState;
};

// The one catalogue is kept for the whole browser session while its authorized scope holds, so an
// unchanged scope is never read twice. Every other browser read keeps its own bounded retention
// instead: the catalogue's unbounded one is deliberate and belongs to this key alone, and a
// later explicit advanced-search result must not inherit it (issue #193).
export const CATALOGUE_RETENTION = { staleTime: Infinity, gcTime: Infinity };
export const BOUNDED_RETENTION = { staleTime: 5 * 60_000, gcTime: 10 * 60_000 };

// The catalogue read's own address: one bounded page after the cursor, and nothing else. The
// cursor is an opaque position in the traversal's ordering, never a grant of access to the rows it
// names.
function cataloguePageUrl(after: string | null) {
  return after === null
    ? '/api/properties/catalogue'
    : `/api/properties/catalogue?after=${encodeURIComponent(after)}`;
}

// The one browser-cache key for this authorized context: a catalogue is reused only by the same
// employee and role, the same server-maintained access revision and the same summary shape.
export function catalogueQueryKey(scope: EmployeeSession) {
  return [
    'property-catalogue',
    renderedSession(scope.employee),
    scope.accessRevision,
    CATALOGUE_SCHEMA_VERSION,
  ];
}

// One bounded page of the catalogue, read on the caller's own session. It is shared by the cached
// traversal a first load runs (#188) and by the deliberate replacement read a refresh performs
// (#190), so both walk exactly the same authorized cursor.
export function readCataloguePage(
  after: string | null,
  signal: AbortSignal,
): Promise<CataloguePage> {
  return api<CataloguePage>(cataloguePageUrl(after), undefined, signal);
}

export async function readCatalogueReplacement(
  signal: AbortSignal,
  scope: EmployeeSession,
  staged: CatalogueLoadState,
  onPage: (page: CataloguePage) => void,
): Promise<void> {
  await loadProtected({
    signal,
    renderedFor: renderedSession(scope.employee),
    renderedAccessRevision: scope.accessRevision,
    onIdentityChange: () => {
      throw new AccessChangedError();
    },
    source: async () => {
      if (!staged.isComplete)
        await readEveryCataloguePage({
          read: readCataloguePage,
          from: staged.nextCursor,
          signal,
          onPage,
        });
    },
  });
}

const NO_COUNT: CatalogueCount = { total: null, capturedAt: null };

export function catalogueCountQuery(
  scope: EmployeeSession | null,
  generationId: string,
) {
  return queryOptions({
    queryKey: [
      'property-catalogue-count',
      ...(scope ? catalogueQueryKey(scope) : []),
      generationId,
    ],
    enabled: scope !== null && generationId !== '',
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }): Promise<CatalogueCount> => {
      if (!scope) return NO_COUNT;
      try {
        const { data } = await loadProtected({
          signal,
          renderedFor: renderedSession(scope.employee),
          renderedAccessRevision: scope.accessRevision,
          onIdentityChange: () => {
            throw new AccessChangedError();
          },
          source: async () => {
            const answer = await api<{ total?: unknown }>(
              '/api/properties/catalogue/count',
              undefined,
              signal,
            );
            const total = answer?.total;
            return typeof total === 'number' &&
              Number.isSafeInteger(total) &&
              total >= 0
              ? { total, capturedAt: new Date().toISOString() }
              : NO_COUNT;
          },
        });
        return data;
      } catch (failure) {
        if (
          signal.aborted ||
          failure instanceof AccessChangedError ||
          (failure instanceof RequestError &&
            (failure.status === 401 || failure.status === 403))
        )
          throw failure;
        return NO_COUNT;
      }
    },
  });
}

export type CatalogueLoadOptions = {
  // Every indexed batch is published as it is committed, so the first page is searchable before
  // the traversal finishes and before the authorized total arrives.
  publish: (state: CatalogueLoadState) => void;
  generationId: string;
  // The state an interrupted generation reached, so Retry continues from the cursor it stopped at
  // instead of reading the whole traversal again. A new generation passes null.
  resume?: CatalogueLoadState | null;
  // Read the traversal again from the first page even though this scope's finished load is cached.
  // A committed change the server could not hand back a summary for is read this way.
  fresh?: boolean;
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
  const queryKey = catalogueQueryKey(scope);
  // A read that has to learn the property's current values again drops the retained traversal
  // instead of answering with it.
  if (options.fresh) client.removeQueries({ queryKey });
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
        read: readCataloguePage,
        from: state.nextCursor,
        signal: readSignal,
        onPage: (page) => {
          state = indexCataloguePage(state, page, now());
          options.publish(state);
        },
      }).then(() => state);
    },
    ...CATALOGUE_RETENTION,
  });
  // A traversal the browser already finished and cached publishes nothing while it is read back,
  // so the state a freshly mounted loader reads is the one that was cached.
  signal.throwIfAborted();
  options.publish(load);
  return { scope, load };
}
