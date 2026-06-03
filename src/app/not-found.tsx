import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Page not found',
};

const CATEGORIES = [
  'tech', 'politics', 'science', 'business', 'culture', 'sports', 'opinion',
];

export default function NotFound() {
  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center">
          <Link href="/" className="text-xl font-bold tracking-tight text-white hover:text-zinc-300 transition-colors">
            linkdrift
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-24 text-center">
        <p className="text-sm font-mono text-zinc-600">404</p>
        <h1 className="mt-2 text-2xl font-bold text-white">page not found</h1>
        <p className="mt-3 text-sm text-zinc-400">
          That page drifted off. Head back home or pick a category to keep reading.
        </p>

        <div className="mt-8 flex justify-center">
          <Link
            href="/"
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-zinc-200 transition-colors"
          >
            Back to home
          </Link>
        </div>

        <div className="mt-12 pt-6 border-t border-zinc-800 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-zinc-500">
          {CATEGORIES.map(slug => (
            <Link key={slug} href={`/category/${slug}`} className="hover:text-zinc-300 transition-colors">
              {slug}
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
