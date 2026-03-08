/**
 * Author Feed
 * 
 * GET /feed/author/sarahchenai     — All articles by @sarahchenai
 * GET /feed/author/mwebb_sec       — All articles by @mwebb_sec
 * 
 * Supports ?format=json or ?format=atom
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchAuthorArticles,
  generateRSS,
  generateAtom,
  generateJSONFeed,
  CACHE_TTL,
} from '@/lib/feed';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  try {
    const { handle } = await params;
    const url = new URL(req.url);
    const format = url.searchParams.get('format') || 'rss';

    const items = await fetchAuthorArticles(handle);

    const authorName = items[0]?.author_name || handle;
    const meta = {
      title: `Linkdrift — @${handle}`,
      description: `Articles by ${authorName} on X, indexed by Linkdrift.`,
      path: `/feed/author/${handle}`,
    };

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
    if (err.message?.includes('not found')) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error('Author feed error:', err);
    return NextResponse.json({ error: 'Feed generation failed' }, { status: 500 });
  }
}
