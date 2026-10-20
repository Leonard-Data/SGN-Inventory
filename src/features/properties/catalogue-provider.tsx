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
import { api } from '@/features/employees/api';
import { useProtectedData } from '@/features/employees/use-protected-data';
import {
  renderedSession,
  sessionDiffers,
} from '@/features/employees/protected-load';
import type { EmployeeSession } from '@/features/employees/types';
import type { CatalogueIndexEntry } from './address-index';
import { readCatalogue, type ScopedCatalogue } from './catalogue-cache';
import {
  catalogueProgress,
  startCatalogueLoad,
  type CatalogueCount,
  type CatalogueLoadState,
  type CatalogueProgress,
} from './catalogue-load';

// Whether the load behind the browser's catalogue is still arriving, finished, or stopped by an
// error. A browser-held catalogue is a browsing aid only: a lock, an approval or an edit always
// validates against current server state, never against this snapshot.
export type CatalogueStatus = 'loading' | 'complete' | 'failed';

// What a consumer of the catalogue reads: the index the address box searches, the structured
// progress of the load behind it, and how to retry a load that stopped. Nothing here authorizes
// anything.
export type CatalogueState = {
  status: CatalogueStatus;
  index: readonly CatalogueIndexEntry[];
  progress: CatalogueProgress;
  scope: EmployeeSession | null;
  retry: () => void;
};

const NO_COUNT: CatalogueCount = { total: null, capturedAt: null };

const EMPTY: CatalogueState = {
  status: 'loading',
  index: [],
  progress: catalogueProgress(startCatalogueLoad(''), NO_COUNT),
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

function CatalogueLoader({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [load, setLoad] = useState<CatalogueLoadState>(() =>
    startCatalogueLoad(''),
  );
  const [count, setCount] = useState<CatalogueCount>(NO_COUNT);
  const [scope, setScope] = useState<EmployeeSession | null>(null);
  const sessionRef = useRef<string | null>(null);
  // The latest indexed state, so a retry resumes the generation it interrupted rather than reading
  // the whole traversal again.
  const loadRef = useRef(load);
  const publish = useCallback((state: CatalogueLoadState) => {
    loadRef.current = state;
    setLoad(state);
  }, []);
  const read = useCallback(
    (signal: AbortSignal, session: EmployeeSession) => {
      const identity = `${renderedSession(session.employee)}:${session.accessRevision}`;
      // A scope this loader already started resumes it; a changed scope starts a new generation
      // with nothing indexed from the former authority.
      const resume = sessionRef.current === identity ? loadRef.current : null;
      const generationId = resume ? resume.generationId : crypto.randomUUID();
      sessionRef.current = identity;
      setScope(session);
      if (!resume) {
        setCount(NO_COUNT);
        publish(startCatalogueLoad(generationId));
      }
      return readCatalogue(queryClient, signal, session, {
        publish,
        generationId,
        resume,
      });
    },
    [publish, queryClient],
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
  // The authorized total is counted once per generation, on its own request: a slow or failed
  // count leaves the total unknown, never delays a batch, and never decides where the traversal
  // stops.
  useEffect(() => {
    if (!sessionIdentity || !load.generationId) return;
    const controller = new AbortController();
    void api<{ total?: unknown }>(
      '/api/properties/catalogue/count',
      undefined,
      controller.signal,
    )
      .then((answer) => {
        const total = Number(answer?.total);
        if (!Number.isInteger(total) || total < 0) return;
        setCount({ total, capturedAt: new Date().toISOString() });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [sessionIdentity, load.generationId]);

  const progress = useMemo(() => catalogueProgress(load, count), [load, count]);
  const status: CatalogueStatus = error
    ? 'failed'
    : progress.isComplete
      ? 'complete'
      : 'loading';
  const state = useMemo<CatalogueState>(
    () => ({ status, index: load.index, progress, scope, retry: reload }),
    [status, load.index, progress, scope, reload],
  );
  return (
    <CatalogueContext.Provider value={state}>
      {children}
    </CatalogueContext.Provider>
  );
}
