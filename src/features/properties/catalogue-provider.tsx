'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { RequestError } from '@/features/employees/api';
import { useProtectedData } from '@/features/employees/use-protected-data';
import {
  AccessChangedError,
  renderedSession,
  sessionDiffers,
} from '@/features/employees/protected-load';
import type { EmployeeSession } from '@/features/employees/types';
import type { CatalogueIndexEntry } from './address-index';
import {
  catalogueCountQuery,
  catalogueQueryKey,
  readCatalogue,
  readCatalogueReplacement,
  type ScopedCatalogue,
} from './catalogue-cache';
import {
  catalogueProgress,
  startCatalogueLoad,
  type CatalogueCount,
  type CatalogueLoadState,
  type CatalogueProgress,
} from './catalogue-load';
import {
  acceptReplacementPage,
  acceptWorking,
  beginRefresh,
  catalogueRefreshView,
  commitReplacement,
  failReplacement,
  NO_GENERATIONS,
  startWorking,
  type CatalogueGenerations,
  type CatalogueRefreshView,
} from './catalogue-refresh';

// Whether the load behind the browser's catalogue is still arriving, finished, or stopped by an
// error. A browser-held catalogue is a browsing aid only: a lock, an approval or an edit always
// validates against current server state, never against this snapshot.
export type CatalogueStatus = 'loading' | 'complete' | 'failed';

// What a consumer of the catalogue reads: the index the address box searches, the structured
// progress of the catalogue in use, the replacement a refresh is building separately, and how to
// retry a load that stopped or refresh a catalogue that finished. Nothing here authorizes anything.
export type CatalogueState = {
  status: CatalogueStatus;
  index: readonly CatalogueIndexEntry[];
  progress: CatalogueProgress;
  // The refresh line, kept apart from the working catalogue's own progress: a refresh never claims
  // the catalogue the user is searching has changed until its replacement is swapped in.
  refresh: CatalogueRefreshView;
  refreshCatalogue: () => void;
  scope: EmployeeSession | null;
  retry: () => void;
};

const NO_COUNT: CatalogueCount = { total: null, capturedAt: null };
// A catalogue that has not started: what the shell shows before the session answers.
const NO_LOAD = startCatalogueLoad('');

const EMPTY: CatalogueState = {
  status: 'loading',
  index: [],
  progress: catalogueProgress(NO_LOAD, NO_COUNT),
  refresh: { status: 'idle' },
  refreshCatalogue: () => {},
  scope: null,
  retry: () => {},
};
const CatalogueContext = createContext<CatalogueState>(EMPTY);

export function useCatalogue(session: EmployeeSession | null): CatalogueState {
  const catalogue = useContext(CatalogueContext);
  if (
    catalogue.scope &&
    (!session ||
      sessionDiffers(
        renderedSession(catalogue.scope.employee),
        catalogue.scope.accessRevision,
        session,
      ))
  )
    return EMPTY;
  return catalogue;
}

export function CatalogueProvider({ children }: { children: ReactNode }) {
  // One client for the whole authenticated application, created once per browser session: the
  // catalogue outlives every route inside the shell, and a page reload is what starts it over.
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <CatalogueLoader>{children}</CatalogueLoader>
    </QueryClientProvider>
  );
}

function useCatalogueCount(
  scope: EmployeeSession | null,
  generationId: string,
  onAuthorityFailure: (failure: unknown, scope: EmployeeSession) => void,
): CatalogueCount {
  const { data, error } = useQuery(catalogueCountQuery(scope, generationId));
  useEffect(() => {
    if (error && scope) onAuthorityFailure(error, scope);
  }, [error, scope, onAuthorityFailure]);
  return data ?? NO_COUNT;
}

function CatalogueLoader({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // The catalogue the user is searching and the replacement a refresh is building, folded together
  // by the rule in `catalogue-refresh.ts`.
  const [generations, setGenerations] =
    useState<CatalogueGenerations>(NO_GENERATIONS);
  const [scope, setScope] = useState<EmployeeSession | null>(null);
  const sessionRef = useRef<string | null>(null);
  // The latest folded state, so a retry resumes the generation it interrupted and a refresh starts
  // from the state the next render has not seen yet.
  const generationsRef = useRef(generations);
  // The refresh in flight, so a second press cannot start an overlapping load and a changed
  // authority can abandon the replacement it no longer owns.
  const refreshRun = useRef<AbortController | null>(null);
  const apply = useCallback((next: CatalogueGenerations) => {
    generationsRef.current = next;
    setGenerations(next);
  }, []);
  const dropCatalogue = useCallback(() => {
    refreshRun.current?.abort();
    refreshRun.current = null;
    queryClient.clear();
    sessionRef.current = null;
    apply(NO_GENERATIONS);
    setScope(null);
  }, [apply, queryClient]);
  const publish = useCallback(
    (state: CatalogueLoadState) =>
      apply(acceptWorking(generationsRef.current, state)),
    [apply],
  );
  const read = useCallback(
    (signal: AbortSignal, session: EmployeeSession) => {
      const identity = `${renderedSession(session.employee)}:${session.accessRevision}`;
      // A scope this loader already started resumes it; a changed scope starts a new generation
      // with nothing indexed or staged from the former authority.
      const resume =
        sessionRef.current === identity ? generationsRef.current.working : null;
      const generationId = resume ? resume.generationId : crypto.randomUUID();
      if (!resume) dropCatalogue();
      sessionRef.current = identity;
      setScope(session);
      if (!resume) apply(startWorking(generationId));
      return readCatalogue(queryClient, signal, session, {
        publish,
        generationId,
        resume,
      });
    },
    [apply, dropCatalogue, publish, queryClient],
  );
  const { error, reload, clear } = useProtectedData<ScopedCatalogue>(
    read,
    dropCatalogue,
  );
  const onAuthorityFailure = useCallback(
    (failure: unknown, failedScope: EmployeeSession) => {
      if (
        sessionRef.current !==
          `${renderedSession(failedScope.employee)}:${failedScope.accessRevision}` ||
        !(
          failure instanceof AccessChangedError ||
          (failure instanceof RequestError &&
            (failure.status === 401 || failure.status === 403))
        )
      )
        return;
      clear();
      if (failure instanceof RequestError)
        window.location.replace(
          failure.status === 401 ? '/login' : '/access-denied',
        );
      else void reload();
    },
    [clear, reload],
  );

  const workingCount = useCatalogueCount(
    scope,
    generations.working?.generationId ?? '',
    onAuthorityFailure,
  );
  // The replacement's own total, counted exactly as the working load's is: a refresh states its own
  // progress and never borrows the count of the catalogue it is replacing.
  const stagedCount = useCatalogueCount(
    scope,
    generations.staged?.generationId ?? '',
    onAuthorityFailure,
  );
  useEffect(() => () => refreshRun.current?.abort(), []);

  const refreshCatalogue = useCallback(() => {
    const session = scope;
    const state = generationsRef.current;
    if (!session || refreshRun.current) return;
    const resume = state.failure ? state.staged : null;
    const generationId = resume?.generationId ?? crypto.randomUUID();
    const started = beginRefresh(state, generationId, resume);
    // Refused: a replacement is already running, or the user has no complete catalogue to replace.
    if (started === state) return;
    apply(started);
    const controller = new AbortController();
    refreshRun.current = controller;
    void readCatalogueReplacement(
      controller.signal,
      session,
      started.staged!,
      (page) =>
        apply(
          acceptReplacementPage(
            generationsRef.current,
            generationId,
            page,
            new Date().toISOString(),
          ),
        ),
    )
      .then(() => {
        controller.signal.throwIfAborted();
        const next = commitReplacement(generationsRef.current, generationId);
        if (next.working?.generationId !== generationId) return;
        queryClient.setQueryData(catalogueQueryKey(session), next.working);
        apply(next);
      })
      .catch((failure: unknown) => {
        // An abandoned read is not a failure to report: the scope that owned it is gone.
        if (controller.signal.aborted) return;
        apply(
          failReplacement(
            generationsRef.current,
            generationId,
            failure instanceof AccessChangedError
              ? 'access-changed'
              : failure instanceof RequestError
                ? failure.status === 401
                  ? 'unauthenticated'
                  : failure.status === 403
                    ? 'access-denied'
                    : failure.code
                : 'unavailable',
          ),
        );
        onAuthorityFailure(failure, session);
      })
      .finally(() => {
        if (refreshRun.current === controller) refreshRun.current = null;
      });
  }, [apply, onAuthorityFailure, queryClient, scope]);

  const progress = useMemo(
    () => catalogueProgress(generations.working ?? NO_LOAD, workingCount),
    [generations.working, workingCount],
  );
  const status: CatalogueStatus = error
    ? 'failed'
    : progress.isComplete
      ? 'complete'
      : 'loading';
  const state = useMemo<CatalogueState>(
    () => ({
      status,
      index: generations.working?.index ?? [],
      progress,
      refresh: catalogueRefreshView(generations, stagedCount),
      refreshCatalogue,
      scope,
      retry: reload,
    }),
    [
      status,
      generations,
      progress,
      stagedCount,
      refreshCatalogue,
      scope,
      reload,
    ],
  );
  return (
    <CatalogueContext.Provider value={state}>
      {children}
    </CatalogueContext.Provider>
  );
}
