/**
 * Main RSS Feed
 * 
 * GET /feed.xml   — RSS 2.0 (latest articles, all categories)
 * GET /feed.json  — JSON Feed
 * GET /feed.atom  — Atom
 * 
 * Also aliased from the app router:
 *   /feed → redirects to /feed.xml
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchLatestArticles,
  generateRSS,
  generateAtom,
  generateJSONFeed,
  CACHE_TTL,
} from '@/lib/feed';

const META = {
  title: 'Byline — Latest Articles',
  description: 'The latest long-form articles from X, curated and categorized by Byline.',
  path: '/feed.xml',
};

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const format = url.searchParams.get('format') || 'rss';
    const items = await fetchLatestArticles();

    const headers = {
      'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=${CACHE_TTL * 2}`,
    };

    if (format === 'json') {
      return NextResponse.json(generateJSONFeed(items, META), { headers });
    }

    if (format === 'atom') {
      return new NextResponse(generateAtom(items, { ...META, path: '/feed.atom' }), {
        headers: { ...headers, 'Content-Type': 'application/atom+xml; charset=utf-8' },
      });
    }

    // Default: RSS 2.0
    return new NextResponse(generateRSS(items, META), {
      headers: { ...headers, 'Content-Type': 'application/rss+xml; charset=utf-8' },
    });
  } catch (err: any) {
    console.error('Feed error:', err);
    return NextResponse.json({ error: 'Feed generation failed' }, { status: 500 });
  }
}
