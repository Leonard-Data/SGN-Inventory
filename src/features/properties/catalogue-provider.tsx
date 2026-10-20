'use client';
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { api } from '@/features/employees/api';
import type { EmployeeSession } from '@/features/employees/types';
import { buildAddressIndex, type CatalogueIndexEntry } from './address-index';
import { CATALOGUE_SCHEMA_VERSION } from './catalogue';
import type { CataloguePage } from './types';

// The catalogue's one read. The browser owns the request lifecycle from here: the first page is
// read once per authorized context and kept in memory, so opening a property and coming back does
// not read it again.
const CATALOGUE_URL = '/api/properties/catalogue';

// What the address box reads: the index of the page the browser holds and the honest state of the
// load behind it. Nothing here authorizes anything - a lock, an approval or an edit always
// validates against current server state, never against this browsing snapshot.
export type CatalogueState = {
  status: 'loading' | 'ready' | 'failed';
  index: readonly CatalogueIndexEntry[];
  loadedCount: number;
};

const EMPTY: CatalogueState = { status: 'loading', index: [], loadedCount: 0 };

const CatalogueContext = createContext<CatalogueState>(EMPTY);

export function useCatalogue(): CatalogueState {
  return useContext(CatalogueContext);
}

export function CatalogueProvider({ children }: { children: ReactNode }) {
  // One client for the whole authenticated application, created once per browser session: the
  // catalogue outlives every route inside the shell, and a page reload is what starts it over.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // A read is retried when a person asks for it again, not on its own.
          queries: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <CatalogueLoader />
      {children}
    </QueryClientProvider>
  );
}

function CatalogueLoader() {
  // The authorized context the catalogue belongs to: the employee's own identity and the
  // server-maintained access revision, both read from the session the application already
  // authorizes on. An access change moves the query key, so a catalogue authorized under other
  // authority is never reused.
  const session = useQuery({
    queryKey: ['session-scope'],
    queryFn: () => api<EmployeeSession>('/api/session'),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const scope = session.data ?? null;
  const catalogue = useQuery({
    queryKey: [
      'property-catalogue',
      scope?.employee.id ?? 'no-session',
      scope?.accessRevision ?? 0,
      CATALOGUE_SCHEMA_VERSION,
    ],
    queryFn: () => api<CataloguePage>(CATALOGUE_URL),
    enabled: scope !== null,
    // This catalogue only: one catalogue per authorized context, kept in browser memory until the
    // session ends or the scope changes, and never refetched by a remount, a focus or a
    // reconnect. Detail and advanced-search reads keep their own bounded retention.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    retry: false,
  });
  // The index is built once per loaded page, not once per keystroke, and every entry keeps the
  // recorded address text it was built from.
  const page = catalogue.data ?? null;
  const index = useMemo(
    () => buildAddressIndex(page?.properties ?? []),
    [page],
  );
  const failed = session.isError || catalogue.isError;
  const state = useMemo<CatalogueState>(
    () => ({
      status: catalogue.isSuccess ? 'ready' : failed ? 'failed' : 'loading',
      index,
      loadedCount: index.length,
    }),
    [catalogue.isSuccess, failed, index],
  );
  return (
    <CatalogueContext.Provider value={state}>{null}</CatalogueContext.Provider>
  );
}
