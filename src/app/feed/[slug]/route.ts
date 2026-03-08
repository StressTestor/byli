/**
 * Dynamic Feed Routes
 * 
 * GET /feed/tech         — Technology articles
 * GET /feed/politics     — Politics articles
 * GET /feed/science      — Science articles
 * GET /feed/business     — Business articles
 * GET /feed/culture      — Culture articles
 * GET /feed/sports       — Sports articles
 * GET /feed/opinion      — Opinion articles
 * GET /feed/featured     — Editorially featured articles
 * GET /feed/trending     — Trending this week
 * 
 * All support ?format=json or ?format=atom
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchCategoryArticles,
  fetchFeaturedArticles,
  fetchTrendingArticles,
  generateRSS,
  generateAtom,
  generateJSONFeed,
  CACHE_TTL,
} from '@/lib/feed';

const CATEGORY_LABELS: Record<string, string> = {
  tech: 'Technology',
  politics: 'Politics',
  science: 'Science',
  business: 'Business',
  culture: 'Culture',
  sports: 'Sports',
  opinion: 'Opinion',
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const url = new URL(req.url);
    const format = url.searchParams.get('format') || 'rss';

    let items;
    let meta;

    if (slug === 'featured') {
      items = await fetchFeaturedArticles();
      meta = {
        title: 'Linkdrift — Featured Articles',
        description: 'Editorially curated long-form articles from X.',
        path: `/feed/featured`,
      };
    } else if (slug === 'trending') {
      items = await fetchTrendingArticles();
      meta = {
        title: 'Linkdrift — Trending This Week',
        description: 'The most engaging X Articles from the past 7 days.',
        path: `/feed/trending`,
      };
    } else if (CATEGORY_LABELS[slug]) {
      items = await fetchCategoryArticles(slug);
      meta = {
        title: `Linkdrift — ${CATEGORY_LABELS[slug]}`,
        description: `Latest ${CATEGORY_LABELS[slug].toLowerCase()} articles from X, curated by Linkdrift.`,
        path: `/feed/${slug}`,
      };
    } else {
      return NextResponse.json({ error: `Unknown feed: ${slug}` }, { status: 404 });
    }

    const headers = {
      'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=${CACHE_TTL * 2}`,
    };

    if (format === 'json') {
      return NextResponse.json(generateJSONFeed(items, meta), { headers });
    }

    if (format === 'atom') {
      return new NextResponse(generateAtom(items, meta), {
        headers: { ...headers, 'Content-Type': 'application/atom+xml; charset=utf-8' },
      });
    }

    return new NextResponse(generateRSS(items, meta), {
      headers: { ...headers, 'Content-Type': 'application/rss+xml; charset=utf-8' },
    });
  } catch (err: any) {
    console.error('Feed error:', err);
    return NextResponse.json({ error: 'Feed generation failed' }, { status: 500 });
  }
}
