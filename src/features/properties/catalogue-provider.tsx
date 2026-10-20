'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query';
import { useProtectedData } from '@/features/employees/use-protected-data';
import {
  renderedSession,
  sessionDiffers,
} from '@/features/employees/protected-load';
import type { EmployeeSession } from '@/features/employees/types';
import { buildAddressIndex, type CatalogueIndexEntry } from './address-index';
import { readCatalogue, type ScopedCatalogue } from './catalogue-cache';

// What the address box reads: the index of the page the browser holds and the honest state of the
// load behind it. Nothing here authorizes anything - a lock, an approval or an edit always
// validates against current server state, never against this browsing snapshot.
export type CatalogueState = {
  status: 'loading' | 'ready' | 'failed';
  index: readonly CatalogueIndexEntry[];
  loadedCount: number;
  scope: EmployeeSession | null;
};

const EMPTY: CatalogueState = {
  status: 'loading',
  index: [],
  loadedCount: 0,
  scope: null,
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
  const read = useCallback(
    (signal: AbortSignal, scope: EmployeeSession) =>
      readCatalogue(queryClient, signal, scope),
    [queryClient],
  );
  const { data, busy, error } = useProtectedData<ScopedCatalogue>(read);
  useEffect(() => {
    if (!busy && !data) queryClient.clear();
  }, [busy, data, queryClient]);
  const snapshot = busy ? null : data;
  const page = snapshot?.page ?? null;
  const index = useMemo(
    () => buildAddressIndex(page?.properties ?? []),
    [page],
  );
  const state = useMemo<CatalogueState>(
    () => ({
      status: error ? 'failed' : snapshot ? 'ready' : 'loading',
      index,
      loadedCount: index.length,
      scope: snapshot?.scope ?? null,
    }),
    [error, snapshot, index],
  );
  return (
    <CatalogueContext.Provider value={state}>
      {children}
    </CatalogueContext.Provider>
  );
}
