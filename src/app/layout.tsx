import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { IBM_Plex_Mono, Inter, Oswald } from 'next/font/google';
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
// Vietnamese subset match the preserved prototype's Google Fonts request; using
// next/font self-hosts them at build time instead of loading a runtime CDN.
const display = Oswald({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600'],
  variable: '--sgn-font-display',
  display: 'swap',
});
const body = Inter({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600'],
  variable: '--sgn-font-body',
  display: 'swap',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500'],
  variable: '--sgn-font-mono',
  display: 'swap',
});

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
    <html
      lang={locale}
      className={`${display.variable} ${body.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
