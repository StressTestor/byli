/**
 * Linkdrift home — server-rendered feed.
 *
 * The first page of articles is fetched on the server (get_feed RPC) and seeded
 * into the client feed island, so titles + internal links are in the initial
 * HTML (crawlable, fast LCP). Interactivity (auth header, tabs, sort, load-more)
 * lives in client islands that hydrate over the server-rendered cards.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { getHomeFeed, getTrending, type TrendingItem } from '@/lib/home-feed';
import { formatCount } from '@/lib/format';
import { SiteHeader } from '@/components/feed/site-header';
import { HomeFeed } from '@/components/feed/home-feed';
import { BannerAd } from '@/components/ads/monetag';

// ISR — regenerate every 15 min (matches the ingestion cycle).
export const revalidate = 900;

// Now that the homepage is server-rendered it can declare its own canonical.
export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

function TrendingPanel({ items }: { items: TrendingItem[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-zinc-800/50 p-4">
      <h2 className="mb-3 font-display text-sm font-semibold text-zinc-300">Trending on linkdrift</h2>
      <ol className="space-y-3">
        {items.map((it, i) => (
          <li key={it.id}>
            <Link href={`/article/${it.id}`} className="group flex items-start gap-2.5">
              <span className="w-4 shrink-0 pt-0.5 text-xs tabular-nums text-accent/70">{i + 1}</span>
              <span className="min-w-0">
                <span className="block overflow-hidden text-sm leading-tight text-zinc-400 transition-colors group-hover:text-white [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]">
                  {it.title}
                </span>
                <span className="text-[11px] text-zinc-600">
                  @{it.authorHandle} · {formatCount(it.likeCount)} likes
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

function FooterLinks() {
  return (
    <div className="space-x-3 px-1 text-[11px] text-zinc-700">
      <Link href="/about" className="hover:text-zinc-500">About</Link>
      <Link href="/privacy" className="hover:text-zinc-500">Privacy</Link>
      <Link href="/terms" className="hover:text-zinc-500">Terms</Link>
    </div>
  );
}

export default async function HomePage() {
  const [feed, trending] = await Promise.all([
    getHomeFeed({ sort: 'POPULAR', pageSize: 20 }),
    getTrending(6),
  ]);

  return (
    <div className="min-h-screen bg-zinc-950">
      <SiteHeader />
      <div className="mx-auto max-w-7xl px-4 pb-12 pt-6">
        <div className="flex gap-8">
          <main className="min-w-0 max-w-2xl flex-1">
            <HomeFeed
              initialArticles={feed.articles}
              initialHasNext={feed.hasNextPage}
              initialCursor={feed.endCursor}
            />
          </main>
          <aside className="hidden w-72 shrink-0 lg:block">
            <div className="sticky top-20 flex flex-col gap-4">
              <TrendingPanel items={trending} />
              <div className="overflow-hidden rounded-xl">
                <BannerAd size="rectangle" />
              </div>
              <FooterLinks />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
