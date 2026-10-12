import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { AppShell } from '@/features/navigation/app-shell';

// One authenticated shell for every product route (ADR 0001). Session and role
// are already enforced server-side by src/proxy.ts before this renders; the
// shell reads the session itself only for the account menu and the role filter.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  return <AppShell locale={locale}>{children}</AppShell>;
}
