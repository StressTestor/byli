// Server-side feed fetch for the homepage, so the first page of articles is in
// the initial HTML (crawlable + fast LCP). Mirrors the get_feed RPC the GraphQL
// resolver uses, so the client island can keep paginating consistently.

import { supabaseAdmin } from '@/lib/supabase-admin';

export type FeedSort = 'FOR_YOU' | 'LATEST' | 'POPULAR';

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
      .limit(limit);
    return ((data as any[]) || []).map((r) => ({
      id: r.id,
      title: r.title,
      authorHandle: r.authors?.handle ?? '',
      likeCount: r.article_stats?.like_count ?? 0,
    }));
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
    // supabaseAdmin isn't generic-typed yet (tracked as audit P1-10), so .rpc
    // args infer as `undefined`; cast like the rest of the codebase until the
    // client gets its Database types.
    const { data, error } = await (supabaseAdmin.rpc as any)('get_feed', {
      p_category_slug: category,
      p_sort: sort,
      p_cursor: cursor,
      p_limit: pageSize + 1, // one extra to detect hasNextPage
    });
    if (error || !data) return { articles: [], hasNextPage: false, endCursor: null };
    const rows = data as any[];
    const hasNextPage = rows.length > pageSize;
    const articles = rows.slice(0, pageSize).map(mapRow);
    const endCursor = articles.length ? articles[articles.length - 1].publishedAt : null;
    return { articles, hasNextPage, endCursor };
  } catch {
    // Never let a feed hiccup take down the homepage — render the shell.
    return { articles: [], hasNextPage: false, endCursor: null };
  }
}
