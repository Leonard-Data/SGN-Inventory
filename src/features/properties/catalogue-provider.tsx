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
  useQueryClient,
} from '@tanstack/react-query';
import { api, RequestError } from '@/features/employees/api';
import { useProtectedData } from '@/features/employees/use-protected-data';
import {
  renderedSession,
  sessionDiffers,
} from '@/features/employees/protected-load';
import type { EmployeeSession } from '@/features/employees/types';
import type { CatalogueIndexEntry } from './address-index';
import {
  catalogueQueryKey,
  readCatalogue,
  readCataloguePage,
  type ScopedCatalogue,
} from './catalogue-cache';
import {
  catalogueProgress,
  readEveryCataloguePage,
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

// The authorized total, counted once per generation on its own request: a slow or failed count
// leaves the total unknown, never delays a batch and never decides where a traversal stops.
function useCatalogueCount(
  sessionIdentity: string | null,
  generationId: string,
): CatalogueCount {
  // A count belongs to one generation: a new generation has none until its own request answers, and
  // a resumed generation keeps the count it already captured instead of counting again.
  const [counted, setCounted] = useState<{
    generationId: string;
    count: CatalogueCount;
  }>({ generationId: '', count: NO_COUNT });
  useEffect(() => {
    if (!sessionIdentity || !generationId) return;
    const controller = new AbortController();
    void api<{ total?: unknown }>(
      '/api/properties/catalogue/count',
      undefined,
      controller.signal,
    )
      .then((answer) => {
        const total = Number(answer?.total);
        if (!Number.isInteger(total) || total < 0) return;
        setCounted({
          generationId,
          count: { total, capturedAt: new Date().toISOString() },
        });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [sessionIdentity, generationId]);
  return generationId !== '' && counted.generationId === generationId
    ? counted.count
    : NO_COUNT;
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
      sessionRef.current = identity;
      setScope(session);
      if (!resume) apply(startWorking(generationId));
      return readCatalogue(queryClient, signal, session, {
        publish,
        generationId,
        resume,
      });
    },
    [apply, publish, queryClient],
  );
  const { data, busy, error, reload } = useProtectedData<ScopedCatalogue>(read);
  // Losing protected data drops the cache the former authority filled; a scope change is read
  // under the new authority instead.
  useEffect(() => {
    if (!busy && !data) queryClient.clear();
  }, [busy, data, queryClient]);

  const sessionIdentity = scope
    ? `${renderedSession(scope.employee)}:${scope.accessRevision}`
    : null;
  const workingCount = useCatalogueCount(
    sessionIdentity,
    generations.working?.generationId ?? '',
  );
  // The replacement's own total, counted exactly as the working load's is: a refresh states its own
  // progress and never borrows the count of the catalogue it is replacing.
  const stagedCount = useCatalogueCount(
    sessionIdentity,
    generations.staged?.generationId ?? '',
  );
  // A refresh belongs to the authority that started it: losing or changing that scope abandons the
  // replacement instead of letting its rows reach the new one.
  useEffect(() => () => refreshRun.current?.abort(), [sessionIdentity]);

  const refreshCatalogue = useCallback(() => {
    const session = scope;
    const state = generationsRef.current;
    if (!session || refreshRun.current) return;
    // Retry continues a stopped generation when its staged rows were kept; otherwise - and for an
    // ordinary refresh - a new generation starts with its progress reset.
    const resume = state.failure?.resumable ? state.staged : null;
    const generationId = resume?.generationId ?? crypto.randomUUID();
    const started = beginRefresh(state, generationId, resume);
    // Refused: a replacement is already running, or the user has no complete catalogue to replace.
    if (started === state) return;
    apply(started);
    const controller = new AbortController();
    refreshRun.current = controller;
    void readEveryCataloguePage({
      read: readCataloguePage,
      from: started.staged?.nextCursor ?? null,
      signal: controller.signal,
      onPage: (page) =>
        apply(
          acceptReplacementPage(
            generationsRef.current,
            generationId,
            page,
            new Date().toISOString(),
          ),
        ),
    })
      .then(() => {
        // The completed replacement is the working catalogue now. The cache the shell's own reads
        // answer from is updated with it, so no later read of this scope can resurrect the
        // catalogue it replaced.
        const working = generationsRef.current.working;
        if (working?.generationId === generationId)
          queryClient.setQueryData(catalogueQueryKey(session), working);
      })
      .catch((failure: unknown) => {
        // An abandoned read is not a failure to report: the scope that owned it is gone.
        if (controller.signal.aborted) return;
        apply(
          failReplacement(
            generationsRef.current,
            generationId,
            failure instanceof RequestError ? failure.code : 'unavailable',
          ),
        );
      })
      .finally(() => {
        if (refreshRun.current === controller) refreshRun.current = null;
      });
  }, [apply, queryClient, scope]);

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
