// Server-side feed fetch for the homepage, so the first page of articles is in
// the initial HTML (crawlable + fast LCP). Mirrors the get_feed RPC the GraphQL
// resolver uses, so the client island can keep paginating consistently.

import { supabaseAdmin } from '@/lib/supabase-admin';
import { filterBlockedTitles } from '@/lib/title-filter';
import { getFeedPage } from '@/lib/feed-page';
import type { FeedSort } from '@/lib/feed-pagination';
export { FEED_SORTS, type FeedSort } from '@/lib/feed-pagination';

export interface FeedArticle {
  id: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  readTimeMin: number | null;
  featured: boolean;
  publishedAt: string;
  authorHandle: string;
  authorName: string;
  authorVerified: boolean;
  likeCount: number;
  bookmarkCount: number;
}

export interface FeedPage {
  articles: FeedArticle[];
  hasNextPage: boolean;
  endCursor: string | null;
}

function mapRow(r: any): FeedArticle {
  return {
    id: r.id,
    title: r.title,
    excerpt: r.excerpt ?? null,
    coverImageUrl: r.cover_image_url ?? null,
    readTimeMin: r.read_time_min ?? null,
    featured: !!r.featured,
    publishedAt: r.published_at,
    authorHandle: r.author_handle ?? '',
    authorName: r.author_display_name ?? r.author_handle ?? '',
    authorVerified: !!r.author_verified,
    likeCount: r.like_count ?? 0,
    bookmarkCount: r.bookmark_count ?? 0,
  };
}

export interface TrendingItem {
  id: string;
  title: string;
  authorHandle: string;
  likeCount: number;
}

export async function getTrending(limit = 6): Promise<TrendingItem[]> {
  try {
    const { data } = await supabaseAdmin
      .from('articles')
      .select('id, title, authors!inner(handle), article_stats!inner(like_count)')
      .eq('status', 'published')
      .order('like_count', { referencedTable: 'article_stats', ascending: false })
      // Over-fetch so blocklisted titles don't leave the panel short.
      .limit(limit * 2);
    const items = ((data as any[]) || []).map((r) => ({
      id: r.id,
      title: r.title,
      authorHandle: r.authors?.handle ?? '',
      likeCount: r.article_stats?.like_count ?? 0,
    }));
    return filterBlockedTitles(items).slice(0, limit);
  } catch {
    return [];
  }
}

export async function getHomeFeed(opts: {
  sort?: FeedSort;
  category?: string | null;
  cursor?: string | null;
  pageSize?: number;
} = {}): Promise<FeedPage> {
  const { sort = 'POPULAR', category = null, cursor = null, pageSize = 20 } = opts;
  try {
    const page = await getFeedPage({ sort, category, after: cursor, first: pageSize });
    return {
      articles: filterBlockedTitles(page.rows.map(mapRow)),
      hasNextPage: page.hasNextPage,
      endCursor: page.endCursor,
    };
  } catch (err) {
    // Never let a feed hiccup take down the homepage — render the shell — but
    // log it so an outage is visible and not mistaken for "no articles".
    console.error('[home-feed] getHomeFeed failed');
    return { articles: [], hasNextPage: false, endCursor: null };
  }
}
