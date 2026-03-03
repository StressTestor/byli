/**
 * Byline Feed Page
 * 
 * Main article feed with integrated ad placements.
 * Demonstrates how NativeAd slots into the article card flow.
 * 
 * Ad placements:
 *   - NativeAd every 6 articles (configurable via NEXT_PUBLIC_FEED_AD_INTERVAL)
 *   - BannerAd in sidebar on desktop
 *   - Interstitial on article click-through to X
 */

'use client';

import React, { useState, useCallback } from 'react';
import { useFeed } from '@/hooks/api';
import { FeedWithAds, BannerAd, NativeAd, useArticleRedirect } from '@/components/ads/monetag';

// ─── Article Card ────────────────────────────────────────────────────

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
  };
  onNavigate: (url: string) => void;
}

function ArticleCard({ article, onNavigate }: ArticleCardProps) {
  return (
    <article
      className="group cursor-pointer border border-zinc-800 rounded-lg p-5 hover:border-zinc-600 transition-colors"
      onClick={() => onNavigate(article.xUrl)}
    >
      <div className="flex items-center gap-2 text-sm text-zinc-500 mb-2">
        <span className="font-medium text-zinc-300">
          @{article.author.handle}
          {article.author.verified && ' ✓'}
        </span>
        <span>·</span>
        <span>{article.readTimeMin} min read</span>
      </div>

      <h2 className="text-lg font-semibold text-zinc-100 group-hover:text-white mb-2 line-clamp-2">
        {article.title}
      </h2>

      <p className="text-sm text-zinc-400 line-clamp-3 mb-3">
        {article.excerpt}
      </p>

      <div className="flex items-center gap-4 text-xs text-zinc-500">
        <span>♡ {article.stats.likeCount}</span>
        <span>⊞ {article.stats.bookmarkCount}</span>
        <span className="ml-auto">
          {new Date(article.publishedAt).toLocaleDateString()}
        </span>
      </div>
    </article>
  );
}

// ─── Native Ad Card (styled to match article cards) ──────────────────

function StyledNativeAd() {
  return (
    <div className="border border-zinc-800/50 rounded-lg p-5 bg-zinc-900/30">
      <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">
        Sponsored
      </div>
      <NativeAd className="min-h-[80px]" />
    </div>
  );
}

// ─── Feed Page ───────────────────────────────────────────────────────

export default function FeedPage() {
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<'FOR_YOU' | 'LATEST' | 'POPULAR'>('FOR_YOU');

  const { articles, loading, hasMore, loadMore } = useFeed({
    category: category || undefined,
    sort,
    first: 20,
  });

  const { redirectToArticle } = useArticleRedirect();

  // Build article card elements
  const articleCards = articles.map((article: any) => (
    <ArticleCard
      key={article.id}
      article={article}
      onNavigate={redirectToArticle}
    />
  ));

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header would go here */}

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex gap-8">
          {/* Main feed column */}
          <main className="flex-1 max-w-2xl">
            {/* Category tabs + sort (existing UI) */}

            {/* Article feed with ad insertion */}
            <div className="flex flex-col gap-4">
              <FeedWithAds
                articles={articleCards}
                renderAd={() => <StyledNativeAd />}
              />
            </div>

            {/* Load more */}
            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loading}
                className="w-full mt-6 py-3 text-sm text-zinc-400 border border-zinc-800 rounded-lg hover:border-zinc-600 transition-colors disabled:opacity-50"
              >
                {loading ? 'Loading...' : 'Load more'}
              </button>
            )}
          </main>

          {/* Sidebar — desktop only */}
          <aside className="hidden lg:block w-72 flex-shrink-0">
            <div className="sticky top-8 flex flex-col gap-6">
              {/* Trending / featured section would go here */}

              {/* Sidebar banner ad */}
              <div className="rounded-lg overflow-hidden">
                <BannerAd size="rectangle" />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
