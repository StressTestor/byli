/**
 * Byline Feed Page
 */

'use client';

import React, { useState, useCallback } from 'react';
import { useFeed } from '@/hooks/api';
import { FeedWithAds, BannerAd, NativeAd, useArticleRedirect } from '@/components/ads/monetag';

// ─── Header ─────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight text-white">byline</h1>
          <span className="text-xs text-zinc-600 hidden sm:inline">the discovery layer for X Articles</span>
        </div>
        <div className="flex items-center gap-3">
          <button className="text-sm text-zinc-400 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-zinc-800/50">
            Log in
          </button>
          <button className="text-sm text-zinc-950 bg-white hover:bg-zinc-200 transition-colors px-3 py-1.5 rounded-md font-medium">
            Sign up
          </button>
        </div>
      </div>
    </header>
  );
}

// ─── Category Tabs ──────────────────────────────────────────────────

const CATEGORIES = [
  { slug: null, label: 'All' },
  { slug: 'tech', label: 'Tech', icon: '⚡' },
  { slug: 'business', label: 'Business', icon: '📈' },
  { slug: 'science', label: 'Science', icon: '🔬' },
  { slug: 'politics', label: 'Politics', icon: '🏛' },
  { slug: 'culture', label: 'Culture', icon: '🎭' },
  { slug: 'sports', label: 'Sports', icon: '⚽' },
  { slug: 'opinion', label: 'Opinion', icon: '💬' },
];

function CategoryTabs({ active, onChange }: { active: string | null; onChange: (slug: string | null) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto no-scrollbar pb-1">
      {CATEGORIES.map(cat => (
        <button
          key={cat.slug ?? 'all'}
          onClick={() => onChange(cat.slug)}
          className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${
            active === cat.slug
              ? 'bg-white text-zinc-950 font-medium'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
          }`}
        >
          {cat.icon && <span className="mr-1">{cat.icon}</span>}
          {cat.label}
        </button>
      ))}
    </div>
  );
}

// ─── Sort Tabs ──────────────────────────────────────────────────────

const SORTS = [
  { key: 'FOR_YOU', label: 'For You' },
  { key: 'LATEST', label: 'Latest' },
  { key: 'POPULAR', label: 'Popular' },
] as const;

function SortTabs({ active, onChange }: { active: string; onChange: (sort: 'FOR_YOU' | 'LATEST' | 'POPULAR') => void }) {
  return (
    <div className="flex gap-1">
      {SORTS.map(s => (
        <button
          key={s.key}
          onClick={() => onChange(s.key)}
          className={`px-3 py-1 rounded-md text-sm transition-colors ${
            active === s.key
              ? 'text-white bg-zinc-800 font-medium'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

// ─── Article Card ───────────────────────────────────────────────────

interface ArticleCardProps {
  article: {
    id: string;
    title: string;
    excerpt: string;
    xUrl: string;
    author: { handle: string; displayName: string; verified: boolean };
    stats: { likeCount: number; bookmarkCount: number };
    readTimeMin: number;
    publishedAt: string;
    featured?: boolean;
  };
  onNavigate: (url: string) => void;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ArticleCard({ article, onNavigate }: ArticleCardProps) {
  return (
    <article
      className="group cursor-pointer border border-zinc-800/60 rounded-xl p-5 hover:border-zinc-600 hover:bg-zinc-900/30 transition-all duration-200"
      onClick={() => onNavigate(article.xUrl)}
    >
      {article.featured && (
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-400/80 mb-2.5 uppercase tracking-wider">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
          Featured
        </div>
      )}

      <div className="flex items-center gap-2 text-[13px] text-zinc-500 mb-2">
        <span className="font-medium text-zinc-300">
          @{article.author.handle}
        </span>
        {article.author.verified && (
          <svg className="w-3.5 h-3.5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        )}
        <span className="text-zinc-600">·</span>
        <span>{article.readTimeMin} min read</span>
        <span className="text-zinc-600">·</span>
        <span>{timeAgo(article.publishedAt)}</span>
      </div>

      <h2 className="text-[17px] font-semibold text-zinc-100 group-hover:text-white mb-1.5 leading-snug line-clamp-2">
        {article.title}
      </h2>

      <p className="text-sm text-zinc-500 leading-relaxed line-clamp-2 mb-3">
        {article.excerpt}
      </p>

      <div className="flex items-center gap-4 text-xs text-zinc-600">
        <span className="flex items-center gap-1 hover:text-zinc-400 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
          </svg>
          {article.stats.likeCount}
        </span>
        <span className="flex items-center gap-1 hover:text-zinc-400 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
          </svg>
          {article.stats.bookmarkCount}
        </span>
        <span className="ml-auto flex items-center gap-1 text-zinc-600 group-hover:text-zinc-400 transition-colors">
          Read on X
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
          </svg>
        </span>
      </div>
    </article>
  );
}

// ─── Loading Skeleton ───────────────────────────────────────────────

function ArticleSkeleton() {
  return (
    <div className="border border-zinc-800/40 rounded-xl p-5 animate-pulse">
      <div className="flex gap-2 mb-3">
        <div className="h-3 w-20 bg-zinc-800 rounded" />
        <div className="h-3 w-16 bg-zinc-800 rounded" />
      </div>
      <div className="h-5 w-3/4 bg-zinc-800 rounded mb-2" />
      <div className="h-3 w-full bg-zinc-800/60 rounded mb-1.5" />
      <div className="h-3 w-2/3 bg-zinc-800/60 rounded mb-3" />
      <div className="flex gap-4">
        <div className="h-3 w-8 bg-zinc-800/40 rounded" />
        <div className="h-3 w-8 bg-zinc-800/40 rounded" />
      </div>
    </div>
  );
}

// ─── Empty State ────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="text-center py-16">
      <div className="text-4xl mb-3">📭</div>
      <h3 className="text-lg font-medium text-zinc-300 mb-1">No articles yet</h3>
      <p className="text-sm text-zinc-500">Check back soon or try a different category.</p>
    </div>
  );
}

// ─── Styled Native Ad ───────────────────────────────────────────────

function StyledNativeAd() {
  return (
    <div className="border border-zinc-800/30 rounded-xl p-5 bg-zinc-900/20">
      <div className="text-[10px] uppercase tracking-wider text-zinc-700 mb-2">
        Sponsored
      </div>
      <NativeAd className="min-h-[80px]" />
    </div>
  );
}

// ─── Trending Sidebar ───────────────────────────────────────────────

function TrendingSidebar() {
  return (
    <div className="border border-zinc-800/40 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-zinc-300 mb-3">Trending</h3>
      <div className="space-y-3">
        {['AI', 'Open Source', 'Startups', 'Web3', 'Security'].map((topic, i) => (
          <div key={topic} className="flex items-center gap-2">
            <span className="text-xs text-zinc-600 w-4">{i + 1}</span>
            <span className="text-sm text-zinc-400 hover:text-white cursor-pointer transition-colors">{topic}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Feed Page ──────────────────────────────────────────────────────

export default function FeedPage() {
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<'FOR_YOU' | 'LATEST' | 'POPULAR'>('FOR_YOU');

  const { articles, loading, hasMore, loadMore, error } = useFeed({
    category: category || undefined,
    sort,
    pageSize: 20,
  });

  const { redirectToArticle } = useArticleRedirect();

  const articleCards = articles.map((article: any) => (
    <ArticleCard
      key={article.id}
      article={article}
      onNavigate={redirectToArticle}
    />
  ));

  return (
    <div className="min-h-screen bg-zinc-950">
      <Header />

      <div className="max-w-7xl mx-auto px-4 pt-6 pb-12">
        {/* Controls */}
        <div className="max-w-2xl mb-5 space-y-3">
          <CategoryTabs active={category} onChange={setCategory} />
          <div className="flex items-center justify-between">
            <SortTabs active={sort} onChange={setSort} />
            <span className="text-xs text-zinc-600">
              {articles.length > 0 && `${articles.length} articles`}
            </span>
          </div>
        </div>

        <div className="flex gap-8">
          {/* Main feed */}
          <main className="flex-1 max-w-2xl">
            {loading && articles.length === 0 ? (
              <div className="flex flex-col gap-4">
                {[1, 2, 3, 4, 5].map(i => <ArticleSkeleton key={i} />)}
              </div>
            ) : error ? (
              <div className="text-center py-16">
                <div className="text-4xl mb-3">⚠️</div>
                <h3 className="text-lg font-medium text-zinc-300 mb-1">Something went wrong</h3>
                <p className="text-sm text-zinc-500">{error}</p>
              </div>
            ) : articles.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="flex flex-col gap-3">
                <FeedWithAds
                  articles={articleCards}
                  renderAd={() => <StyledNativeAd />}
                />
              </div>
            )}

            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loading}
                className="w-full mt-6 py-3 text-sm text-zinc-400 border border-zinc-800/60 rounded-xl hover:border-zinc-600 hover:bg-zinc-900/30 transition-all disabled:opacity-50"
              >
                {loading ? 'Loading...' : 'Load more'}
              </button>
            )}
          </main>

          {/* Sidebar */}
          <aside className="hidden lg:block w-72 flex-shrink-0">
            <div className="sticky top-20 flex flex-col gap-4">
              <TrendingSidebar />
              <div className="rounded-xl overflow-hidden">
                <BannerAd size="rectangle" />
              </div>
              <div className="text-[11px] text-zinc-700 space-x-3 px-1">
                <a href="#" className="hover:text-zinc-500">About</a>
                <a href="#" className="hover:text-zinc-500">API</a>
                <a href="#" className="hover:text-zinc-500">Privacy</a>
                <a href="#" className="hover:text-zinc-500">Terms</a>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
