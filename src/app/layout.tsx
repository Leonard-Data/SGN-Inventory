import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { IBM_Plex_Mono, Inter, Oswald } from 'next/font/google';
import './globals.css';
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="vi"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
