import { hashKey, type QueryClient } from '@tanstack/react-query';
import { api } from '../employees/api.ts';
import { renderedSession } from '../employees/protected-load.ts';
import type { EmployeeSession } from '../employees/types';
import { CATALOGUE_SCHEMA_VERSION } from './catalogue.ts';
import type { CataloguePage } from './types';

export type ScopedCatalogue = { scope: EmployeeSession; page: CataloguePage };

export async function readCatalogue(
  client: QueryClient,
  signal: AbortSignal,
  scope: EmployeeSession,
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
  const page = await client.fetchQuery({
    queryKey,
    queryFn: ({ signal: querySignal }) =>
      api<CataloguePage>(
        '/api/properties/catalogue',
        undefined,
        AbortSignal.any([signal, querySignal]),
      ),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return { scope, page };
}
