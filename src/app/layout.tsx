import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { fontVariables } from './fonts';
// Reports to the Vercel project that served the request; the project's
// dashboard Analytics view must also be enabled, or nothing is collected.
import { Analytics } from '@vercel/analytics/next';
// Import order is the cascade: legacy global rules first, then the design-system
// token layer, then the app layer that owns the shared vocabulary, then the
// scoped auth sheet. globals.css shrinks to the classes the app layer does not
// define; app.css and sgn-app.css are verbatim ports of the design package.
import './globals.css';
import './app.css';
import './sgn-app.css';
import './sgn-surfaces.css';
import './sgn-auth.css';

// Canonical authentication typography (ticket #50). Families, weights and the
// Vietnamese subset match the preserved prototype's Google Fonts request; the
// files are vendored in ./fonts (see ./fonts.ts) so the build never fetches
// them from Google.

export const metadata: Metadata = {
  title: 'SGN Inventory',
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // The locale cookie is the persisted preference (set_my_locale writes it), so
  // the document language is correct on the first paint of every route.
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  return (
    <html lang={locale} className={fontVariables} suppressHydrationWarning>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
