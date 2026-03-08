/**
 * Linkdrift Root Layout
 *
 * Wraps the entire app in providers:
 *   - MoneytagProvider (ad system, toggleable via env)
 *
 * Loads inter font, sets dark theme defaults.
 */

import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { MoneytagProvider } from '@/components/ads/monetag';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Linkdrift — Where X Articles surface',
  description: 'Browse, search, and discover long-form Articles published on X. The content layer X forgot to build.',
  openGraph: {
    title: 'Linkdrift',
    description: 'Where X Articles surface',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Linkdrift',
    description: 'Where X Articles surface',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-zinc-950 text-zinc-100 antialiased`}>
        <MoneytagProvider>
          {children}
        </MoneytagProvider>
        <Analytics />
      </body>
    </html>
  );
}
