import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'About',
  description: 'Linkdrift surfaces long-form articles published on X so you can discover great writing.',
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center">
          <Link href="/" className="text-xl font-bold tracking-tight text-white hover:text-zinc-300 transition-colors">
            linkdrift
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold text-white mb-6">about linkdrift</h1>

        <div className="prose prose-invert prose-zinc max-w-none space-y-4 text-zinc-300 text-sm leading-relaxed">
          <p>
            Linkdrift is where X Articles surface. We aggregate and categorize long-form articles
            published on X/Twitter so you can discover great writing without endless scrolling.
          </p>

          <p>
            X launched Articles as a way for creators to publish long-form content directly on the
            platform. The problem is there is no good way to discover them. They get buried in timelines,
            lost in the algorithm, and forgotten. Linkdrift fixes that.
          </p>

          <p>
            We automatically collect articles from notable authors, categorize them by topic, and let
            you browse, search, and save the ones that matter to you. Think of it as a reading layer
            on top of X.
          </p>

          <h2 className="text-lg font-semibold text-white pt-4">how it works</h2>

          <p>
            Our ingestion system monitors curated accounts on X for new article publications. When we
            find one, we extract the metadata, categorize it, and add it to the feed. Users can also
            submit articles they find interesting for review.
          </p>

          <h2 className="text-lg font-semibold text-white pt-4">get in touch</h2>

          <p>
            Have feedback, found a bug, or want to suggest a feature? Reach out on{' '}
            <a href="https://x.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
              X
            </a>{' '}
            or open an issue on our GitHub.
          </p>
        </div>

        <div className="mt-12 pt-6 border-t border-zinc-800 text-xs text-zinc-600 flex gap-4">
          <Link href="/privacy" className="hover:text-zinc-400">Privacy</Link>
          <Link href="/terms" className="hover:text-zinc-400">Terms</Link>
          <Link href="/" className="hover:text-zinc-400">Home</Link>
        </div>
      </main>
    </div>
  );
}
