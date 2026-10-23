import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { AppShell } from '@/features/navigation/app-shell';
import { CatalogueProvider } from '@/features/properties/catalogue-provider';
import { InventoryListStateProvider } from '@/features/properties/list-state-provider';

// One authenticated shell for every product route (ADR 0001). Session and role
// are already enforced server-side by src/proxy.ts before this renders; the
// shell reads the session itself only for the account menu and the role filter.
//
// The property catalogue's loader and cache are mounted here once (ADR 0003), so the
// list and a property's details share one browser-held page instead of each reading
// their own. The list's own state (ADR 0005) is mounted beside it for the same reason:
// a visit to a property and back restores the list without reading the catalogue again,
// and a reload of the application is what starts over. Nothing is prefetched while
// rendering: the browser is the one initial loading owner, and no authenticated
// inventory is cached by a shared cache.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  return (
    <AppShell locale={locale}>
      <CatalogueProvider>
        <InventoryListStateProvider>{children}</InventoryListStateProvider>
      </CatalogueProvider>
    </AppShell>
  );
}
