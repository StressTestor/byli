'use client';

import { useCallback, useState } from 'react';
import { gql, useAuth } from '@/hooks/api';
import { ArticleCard } from './article-card';
import type { FeedArticle, FeedSort } from '@/lib/home-feed';

const CATEGORIES: { slug: string | null; label: string }[] = [
  { slug: null, label: 'All' },
  { slug: 'tech', label: 'Tech' },
  { slug: 'business', label: 'Business' },
  { slug: 'science', label: 'Science' },
  { slug: 'politics', label: 'Politics' },
  { slug: 'culture', label: 'Culture' },
  { slug: 'sports', label: 'Sports' },
  { slug: 'opinion', label: 'Opinion' },
];

const SORTS: { key: FeedSort; label: string }[] = [
  { key: 'POPULAR', label: 'Popular' },
  { key: 'LATEST', label: 'Latest' },
  { key: 'FOR_YOU', label: 'For You' },
];

// No viewer fields here (viewerHasLiked/Bookmarked) — keeps the feed off the
// N+1 per-node resolver path. The card doesn't need them.
const FEED_QUERY = `
  query Feed($first: Int, $after: String, $category: String, $sort: FeedSort) {
    articles(first: $first, after: $after, category: $category, sort: $sort) {
      edges { node {
        id title excerpt coverImageUrl readTimeMin featured publishedAt
        author { handle displayName verified }
        stats { likeCount bookmarkCount }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function mapNode(n: any): FeedArticle {
  return {
    id: n.id,
    title: n.title,
    excerpt: n.excerpt ?? null,
    coverImageUrl: n.coverImageUrl ?? null,
    readTimeMin: n.readTimeMin ?? null,
    featured: !!n.featured,
    publishedAt: n.publishedAt,
    authorHandle: n.author?.handle ?? '',
    authorName: n.author?.displayName ?? n.author?.handle ?? '',
    authorVerified: !!n.author?.verified,
    likeCount: n.stats?.likeCount ?? 0,
    bookmarkCount: n.stats?.bookmarkCount ?? 0,
  };
}

export function HomeFeed({
  initialArticles,
  initialHasNext,
  initialCursor,
}: {
  initialArticles: FeedArticle[];
  initialHasNext: boolean;
  initialCursor: string | null;
}) {
  const { user } = useAuth();
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<FeedSort>('POPULAR');
  const [articles, setArticles] = useState<FeedArticle[]>(initialArticles);
  const [hasNext, setHasNext] = useState(initialHasNext);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (opts: { category: string | null; sort: FeedSort; after?: string | null }) => {
      const data = await gql(FEED_QUERY, {
        first: 20,
        after: opts.after ?? null,
        category: opts.category,
        sort: opts.sort,
      });
      return data.articles as { edges: { node: any }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    },
    []
  );

  const applyFilter = useCallback(
    async (nextCategory: string | null, nextSort: FeedSort) => {
      setCategory(nextCategory);
      setSort(nextSort);
      setLoading(true);
      setError(null);
      try {
        const conn = await fetchPage({ category: nextCategory, sort: nextSort });
        setArticles(conn.edges.map((e) => mapNode(e.node)));
        setHasNext(conn.pageInfo.hasNextPage);
        setCursor(conn.pageInfo.endCursor);
      } catch (e: any) {
        setError(e.message || 'Something went wrong');
      } finally {
        setLoading(false);
      }
    },
    [fetchPage]
  );

  const loadMore = useCallback(async () => {
    if (!hasNext || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const conn = await fetchPage({ category, sort, after: cursor });
      setArticles((prev) => [...prev, ...conn.edges.map((e) => mapNode(e.node))]);
      setHasNext(conn.pageInfo.hasNextPage);
      setCursor(conn.pageInfo.endCursor);
    } catch (e: any) {
      setError(e.message || 'Something went wrong');
    } finally {
      setLoadingMore(false);
    }
  }, [hasNext, cursor, loadingMore, category, sort, fetchPage]);

  return (
    <div>
      {/* Controls */}
      <div className="mb-5 space-y-3">
        <div className="no-scrollbar flex gap-1 overflow-x-auto pb-1">
          {CATEGORIES.map((cat) => {
            const active = category === cat.slug;
            return (
              <button
                key={cat.slug ?? 'all'}
                onClick={() => applyFilter(cat.slug, sort)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors ${
                  active ? 'bg-accent font-medium text-zinc-950' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-white'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {SORTS.map((s) => {
              const disabled = s.key === 'FOR_YOU' && !user;
              const active = sort === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => !disabled && applyFilter(category, s.key)}
                  disabled={disabled}
                  title={disabled ? 'Sign in for a personalized feed' : undefined}
                  className={`rounded-md px-3 py-1 text-sm transition-colors ${
                    disabled
                      ? 'cursor-not-allowed text-zinc-700'
                      : active
                        ? 'font-medium text-accent'
                        : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          {articles.length > 0 && (
            <span className="text-xs text-zinc-600">{articles.length} articles</span>
          )}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-zinc-800/40 p-5">
              <div className="mb-3 flex gap-2">
                <div className="h-3 w-20 animate-pulse rounded bg-zinc-800" />
                <div className="h-3 w-12 animate-pulse rounded bg-zinc-800" />
              </div>
              <div className="mb-2 h-5 w-3/4 animate-pulse rounded bg-zinc-800" />
              <div className="h-3 w-full animate-pulse rounded bg-zinc-800/60" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="py-16 text-center">
          <h3 className="mb-1 text-lg font-medium text-zinc-300">Something went wrong</h3>
          <p className="text-sm text-zinc-500">{error}</p>
        </div>
      ) : articles.length === 0 ? (
        <div className="py-16 text-center">
          <h3 className="mb-1 font-display text-lg font-medium text-zinc-300">No articles yet</h3>
          <p className="text-sm text-zinc-500">Check back soon, or try a different category.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {articles.map((a) => (
            <ArticleCard key={a.id} article={a} />
          ))}
        </div>
      )}

      {hasNext && !loading && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="mt-6 w-full rounded-xl border border-zinc-800/60 py-3 text-sm text-zinc-400 transition-all hover:border-zinc-600 hover:bg-zinc-900/30 disabled:opacity-50"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
