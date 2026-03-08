/**
 * Linkdrift Root Layout
 *
 * Wraps the entire app in providers:
 * - MoneytagProvider (ad system, toggleable via env)
 *
 * Loads inter font, sets dark theme defaults.
 */

import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { MoneytagProvider } from '@/components/ads/monetag';
import { JsonLd } from './json-ld';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: 'Linkdrift — Where X Articles Surface',
    template: '%s | Linkdrift',
  },
  description:
    'Browse, search, and discover long-form Articles published on X. The content layer X forgot to build.',

  // google search console + monetag verification
  verification: {
    google: 'dsd05bObBW_Y4InCtajoo0uofpGFdEvboykU9uZ2SFA',
  },
  other: {
    monetag: '57c9ee738eb28477932d68c0be2fb01d',
  },

  // canonical
  metadataBase: new URL('https://linkdrift.app'),
  alternates: {
    canonical: '/',
  },

  // open graph
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://linkdrift.app',
    siteName: 'Linkdrift',
    title: 'Linkdrift — Where X Articles Surface',
    description:
      'Browse, search, and discover long-form Articles published on X. The content layer X forgot to build.',
  },

  // twitter
  twitter: {
    card: 'summary_large_image',
    title: 'Linkdrift — Where X Articles Surface',
    description:
      'Browse, search, and discover long-form Articles published on X. The content layer X forgot to build.',
  },

  // crawl directives
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },

  keywords: [
    'X articles',
    'Twitter articles',
    'long-form content',
    'article discovery',
    'X content',
    'Twitter long-form',
    'article aggregator',
    'content curation',
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-zinc-950 text-zinc-100 antialiased`}>
        <JsonLd />
        <MoneytagProvider>
          {children}
        </MoneytagProvider>
        <Analytics />
      </body>
    </html>
  );
}
