import { supabaseAdmin } from '@/lib/supabase-admin';
import { createSupabaseServer } from '@/lib/supabase-server';
import { filterBlockedTitles } from '@/lib/title-filter';
import type { Enums, Tables } from '@/types/supabase';

// ─── Helpers ─────────────────────────────────────────────────

function encodeCursor(date: string): string {
  return Buffer.from(date).toString('base64');
}

function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64').toString('utf-8');
}

function encodeOffsetCursor(offset: number): string {
  return Buffer.from(`offset:${offset}`).toString('base64');
}

function decodeOffsetCursor(cursor: string): number {
  const raw = Buffer.from(cursor, 'base64').toString('utf-8');
  const n = Number(raw.startsWith('offset:') ? raw.slice(7) : NaN);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function sortMap(sort: string): string {
  switch (sort) {
    case 'FOR_YOU': return 'FOR_YOU';
    case 'LATEST': return 'LATEST';
    case 'POPULAR': return 'POPULAR';
    case 'TOP_RATED': return 'POPULAR';
    default: return 'FOR_YOU';
  }
}

function timeframeFilter(tf: string): string {
  switch (tf) {
    case 'DAY': return new Date(Date.now() - 86400000).toISOString();
    case 'WEEK': return new Date(Date.now() - 604800000).toISOString();
    case 'MONTH': return new Date(Date.now() - 2592000000).toISOString();
    default: return '1970-01-01T00:00:00Z';
  }
}

async function getAuthUser() {
  try {
    const supabase = await createSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}

// ─── Query Resolvers ─────────────────────────────────────────

export const resolvers = {
  Query: {
    // Paginated article feed
    articles: async (_: any, args: {
      first?: number; after?: string; category?: string; sort?: string; search?: string;
    }) => {
      const limit = Math.min(args.first || 20, 50);
      const cursor = args.after ? decodeCursor(args.after) : null;
      const sortKey = sortMap(args.sort || 'FOR_YOU');

      // Search is relevance-ranked, so it pages by offset, not by date.
      if (args.search) {
        const offset = args.after ? decodeOffsetCursor(args.after) : 0;
        const { data, error } = await supabaseAdmin.rpc('search_articles', {
          p_query: args.search,
          p_limit: limit + 1,
          p_offset: offset,
        });
        if (error) throw new Error(error.message);
        return formatOffsetConnection(data || [], limit, offset, transformSearchRow);
      }

      // Use feed function for standard queries
      const { data, error } = await supabaseAdmin.rpc('get_feed', {
        p_category_slug: args.category || undefined,
        p_sort: sortKey,
        p_limit: limit + 1, // fetch one extra to determine hasNextPage
        p_cursor: cursor ?? undefined,
      });

      if (error) throw new Error(error.message);
      return formatFeedConnection(data || [], limit);
    },

    // Single article by ID or X Article ID
    article: async (_: any, args: { id?: string; xArticleId?: string }) => {
      let query = supabaseAdmin
        .from('articles')
        .select(`
          *,
          author:authors(*),
          categories:article_categories(category:categories(*)),
          stats:article_stats(*)
        `)
        .eq('status', 'published');

      if (args.id) query = query.eq('id', args.id);
      else if (args.xArticleId) query = query.eq('x_article_id', args.xArticleId);
      else throw new Error('Must provide id or xArticleId');

      const { data, error } = await query.single();
      if (error) throw new Error(error.message);
      return transformArticle(data);
    },

    // Author profile by handle
    author: async (_: any, args: { handle: string }) => {
      const { data, error } = await supabaseAdmin
        .from('authors')
        .select('*')
        .eq('handle', args.handle)
        .single();

      if (error) throw new Error(`Author @${args.handle} not found`);
      return transformAuthor(data);
    },

    // Trending articles. Ordered by like count, so it pages by offset.
    trending: async (_: any, args: { timeframe?: string; first?: number; after?: string }) => {
      const limit = Math.min(args.first || 20, 50);
      const offset = args.after ? decodeOffsetCursor(args.after) : 0;
      const since = timeframeFilter(args.timeframe || 'WEEK');

      const { data, error } = await supabaseAdmin
        .from('articles')
        .select(`
          *,
          author:authors(*),
          categories:article_categories(category:categories(*)),
          stats:article_stats(*)
        `)
        .eq('status', 'published')
        .gte('published_at', since)
        .order('stats(like_count)', { ascending: false })
        // range() is inclusive: limit + 1 rows, the extra one decides hasNextPage.
        .range(offset, offset + limit);

      if (error) throw new Error(error.message);
      return formatOffsetConnection(data || [], limit, offset, transformArticle);
    },

    // All categories
    categories: async () => {
      const { data, error } = await supabaseAdmin
        .from('categories')
        .select('*')
        .order('sort_order', { ascending: true });

      if (error) throw new Error(error.message);

      // Get article counts per category
      const { data: counts } = await supabaseAdmin
        .from('article_categories')
        .select('category_id');

      const countMap: Record<string, number> = {};
      (counts || []).forEach((row: any) => {
        countMap[row.category_id] = (countMap[row.category_id] || 0) + 1;
      });

      return (data || []).map(cat => transformCategory(cat, countMap[cat.id] || 0));
    },

    // Current user profile
    me: async () => {
      const user = await getAuthUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw new Error(error.message);
      return transformUser(data);
    },

    // User's submissions
    mySubmissions: async (_: any, args: { status?: string }) => {
      const user = await getAuthUser();
      if (!user) throw new Error('Not authenticated');

      let query = supabaseAdmin
        .from('submissions')
        .select('*, category:categories(*)')
        .eq('submitted_by', user.id)
        .order('created_at', { ascending: false });

      if (args.status) {
        query = query.eq('status', args.status.toLowerCase() as Enums<'submission_status'>);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data || []).map(transformSubmission);
    },
  },

  // ─── Mutations ─────────────────────────────────────────────

  Mutation: {
    likeArticle: async (_: any, args: { articleId: string }) => {
      const user = await getAuthUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabaseAdmin
        .from('likes')
        .insert({ user_id: user.id, article_id: args.articleId });

      if (error && !error.message.includes('duplicate')) throw new Error(error.message);
      return resolvers.Query.article(_, { id: args.articleId });
    },

    unlikeArticle: async (_: any, args: { articleId: string }) => {
      const user = await getAuthUser();
      if (!user) throw new Error('Not authenticated');

      await supabaseAdmin
        .from('likes')
        .delete()
        .eq('user_id', user.id)
        .eq('article_id', args.articleId);

      return resolvers.Query.article(_, { id: args.articleId });
    },

    bookmarkArticle: async (_: any, args: { articleId: string }) => {
      const user = await getAuthUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabaseAdmin
        .from('bookmarks')
        .insert({ user_id: user.id, article_id: args.articleId });

      if (error && !error.message.includes('duplicate')) throw new Error(error.message);
      return resolvers.Query.article(_, { id: args.articleId });
    },

    removeBookmark: async (_: any, args: { articleId: string }) => {
      const user = await getAuthUser();
      if (!user) throw new Error('Not authenticated');

      await supabaseAdmin
        .from('bookmarks')
        .delete()
        .eq('user_id', user.id)
        .eq('article_id', args.articleId);

      return resolvers.Query.article(_, { id: args.articleId });
    },

    rateArticle: async (_: any, args: { articleId: string; score: number }) => {
      const user = await getAuthUser();
      if (!user) throw new Error('Not authenticated');
      if (args.score < 1 || args.score > 5) throw new Error('Score must be 1-5');

      const { error } = await supabaseAdmin
        .from('ratings')
        .upsert({
          user_id: user.id,
          article_id: args.articleId,
          score: args.score,
        });

      if (error) throw new Error(error.message);
      return resolvers.Query.article(_, { id: args.articleId });
    },

    removeRating: async (_: any, args: { articleId: string }) => {
      const user = await getAuthUser();
      if (!user) throw new Error('Not authenticated');

      await supabaseAdmin
        .from('ratings')
        .delete()
        .eq('user_id', user.id)
        .eq('article_id', args.articleId);

      return resolvers.Query.article(_, { id: args.articleId });
    },

    submitArticle: async (_: any, args: { input: { url: string; categoryId?: string; notes?: string } }) => {
      const user = await getAuthUser();
      if (!user) throw new Error('Not authenticated');

      // Basic URL validation
      if (!args.input.url.includes('x.com') && !args.input.url.includes('twitter.com')) {
        throw new Error('URL must be an X/Twitter article link');
      }

      const { data, error } = await supabaseAdmin
        .from('submissions')
        .insert({
          submitted_by: user.id,
          url: args.input.url,
          category_id: args.input.categoryId || null,
          notes: args.input.notes || null,
          status: 'pending',
        })
        .select('*, category:categories(*)')
        .single();

      if (error) throw new Error(error.message);
      return transformSubmission(data);
    },

    updateProfile: async (_: any, args: { input: { username?: string; avatarUrl?: string } }) => {
      const user = await getAuthUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabaseAdmin
        .from('profiles')
        .update({
          ...(args.input.username && { username: args.input.username }),
          ...(args.input.avatarUrl && { avatar_url: args.input.avatarUrl }),
        })
        .eq('id', user.id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return transformUser(data);
    },

    createApiKey: async (_: any, args: { label?: string }) => {
      const user = await getAuthUser();
      if (!user) throw new Error('Not authenticated');

      // Generate key
      const rawKey = `bl_${crypto.randomUUID().replace(/-/g, '')}`;
      const keyHash = await hashKey(rawKey);

      const { data, error } = await supabaseAdmin
        .from('api_keys')
        .insert({
          user_id: user.id,
          key_hash: keyHash,
          label: args.label || null,
          tier: 'developer',
          rate_limit: 300,
          revoked: false,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);

      // Return with the raw key (only time it's visible)
      return transformApiKey(data, rawKey);
    },

    revokeApiKey: async (_: any, args: { id: string }) => {
      const user = await getAuthUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabaseAdmin
        .from('api_keys')
        .update({ revoked: true })
        .eq('id', args.id)
        .eq('user_id', user.id);

      if (error) throw new Error(error.message);
      return true;
    },
  },

  // ─── Field Resolvers ──────────────────────────────────────

  Article: {
    viewerHasLiked: async (parent: any) => {
      const user = await getAuthUser();
      if (!user) return false;
      const { data } = await supabaseAdmin
        .from('likes')
        .select('user_id')
        .eq('user_id', user.id)
        .eq('article_id', parent.id)
        .maybeSingle();
      return !!data;
    },
    viewerHasBookmarked: async (parent: any) => {
      const user = await getAuthUser();
      if (!user) return false;
      const { data } = await supabaseAdmin
        .from('bookmarks')
        .select('user_id')
        .eq('user_id', user.id)
        .eq('article_id', parent.id)
        .maybeSingle();
      return !!data;
    },
    viewerRating: async (parent: any) => {
      const user = await getAuthUser();
      if (!user) return null;
      const { data } = await supabaseAdmin
        .from('ratings')
        .select('score')
        .eq('user_id', user.id)
        .eq('article_id', parent.id)
        .maybeSingle();
      return data?.score || null;
    },
  },

  Category: {
    // categories() precomputes counts for the whole list; categories embedded
    // in articles and submissions are counted on demand.
    articleCount: async (parent: { id: string; articleCount?: number }) => {
      if (typeof parent.articleCount === 'number') return parent.articleCount;
      const { count, error } = await supabaseAdmin
        .from('article_categories')
        .select('category_id', { count: 'exact', head: true })
        .eq('category_id', parent.id);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  },

  Author: {
    articles: async (parent: any, args: { first?: number; after?: string }) => {
      const limit = Math.min(args.first || 10, 50);
      let query = supabaseAdmin
        .from('articles')
        .select(`
          *,
          author:authors(*),
          categories:article_categories(category:categories(*)),
          stats:article_stats(*)
        `)
        .eq('author_id', parent.id)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(limit + 1);

      if (args.after) {
        query = query.lt('published_at', decodeCursor(args.after));
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return formatConnection((data || []).map(transformArticle), limit);
    },
  },
};

// ─── Transform Helpers ───────────────────────────────────────

function transformArticle(raw: any): any {
  return {
    id: raw.id,
    xArticleId: raw.x_article_id,
    xUrl: raw.x_url,
    title: raw.title,
    excerpt: raw.excerpt,
    bodyPreview: raw.body_preview,
    author: raw.author ? transformAuthor(raw.author) : null,
    categories: (raw.categories || []).map((ac: any) => transformCategory(ac.category || ac)),
    stats: raw.stats ? {
      likeCount: raw.stats.like_count || 0,
      bookmarkCount: raw.stats.bookmark_count || 0,
      commentCount: raw.stats.comment_count || 0,
      shareCount: raw.stats.share_count || 0,
      ratingCount: raw.stats.rating_count || 0,
      avgRating: raw.stats.avg_rating || 0,
    } : { likeCount: 0, bookmarkCount: 0, commentCount: 0, shareCount: 0, ratingCount: 0, avgRating: 0 },
    coverImageUrl: raw.cover_image_url,
    readTimeMin: raw.read_time_min,
    featured: !!raw.featured,
    publishedAt: raw.published_at,
    indexedAt: raw.indexed_at,
    viewerHasLiked: false,
    viewerHasBookmarked: false,
    viewerRating: null,
  };
}

function transformAuthor(raw: any): any {
  return {
    id: raw.id,
    handle: raw.handle,
    displayName: raw.display_name,
    avatarUrl: raw.avatar_url,
    bio: raw.bio,
    verified: !!raw.verified,
    claimed: !!raw.claimed,
    followerCount: raw.follower_count || 0,
    articleCount: raw.article_count || 0,
  };
}

// articleCount is omitted unless the caller already has it; the Category
// field resolver fills it in.
function transformCategory(raw: Tables<'categories'>, articleCount?: number) {
  return {
    id: raw.id,
    slug: raw.slug,
    label: raw.label,
    icon: raw.icon,
    ...(articleCount === undefined ? {} : { articleCount }),
  };
}

function transformUser(raw: Tables<'profiles'>) {
  return {
    id: raw.id,
    username: raw.username,
    avatarUrl: raw.avatar_url,
    xHandle: raw.x_handle,
  };
}

type SubmissionWithCategory = Tables<'submissions'> & { category: Tables<'categories'> | null };

function transformSubmission(raw: SubmissionWithCategory) {
  return {
    id: raw.id,
    url: raw.url,
    category: raw.category ? transformCategory(raw.category) : null,
    notes: raw.notes,
    // GraphQL enum values are the uppercase names; the column stores lowercase.
    status: (raw.status ?? 'pending').toUpperCase(),
    createdAt: raw.created_at,
    reviewedAt: raw.reviewed_at,
  };
}

// tier and rate_limit fall back to the column defaults ('developer', 300).
function transformApiKey(raw: Tables<'api_keys'>, key: string | null = null) {
  return {
    id: raw.id,
    label: raw.label,
    tier: raw.tier ?? 'developer',
    rateLimit: raw.rate_limit ?? 300,
    lastUsed: raw.last_used,
    createdAt: raw.created_at,
    key,
  };
}

function formatConnection(items: any[], limit: number) {
  const hasNextPage = items.length > limit;
  const edges = items.slice(0, limit).map(item => ({
    node: item,
    cursor: encodeCursor(item.publishedAt || item.published_at || item.indexed_at || new Date().toISOString()),
  }));

  return {
    edges,
    pageInfo: {
      hasNextPage,
      hasPreviousPage: false, // forward-only pagination for now
      startCursor: edges[0]?.cursor || null,
      endCursor: edges[edges.length - 1]?.cursor || null,
    },
    totalCount: edges.length, // page size, as documented on ArticleConnection
  };
}

function formatFeedConnection(items: any[], limit: number) {
  const hasNextPage = items.length > limit;
  const page = items.slice(0, limit);
  // Cursor comes from the unfiltered page so hidden items can't stall Load more.
  const lastRow = page[page.length - 1];
  const edges = filterBlockedTitles(page).map(item => ({
    node: {
      id: item.id || item.article_id,
      title: item.title,
      excerpt: item.excerpt,
      xUrl: item.x_url,
      coverImageUrl: item.cover_image_url,
      // get_feed returns only these author columns; the rest take the same
      // defaults as search results.
      author: {
        id: item.author_id,
        handle: item.author_handle || item.author_display_name,
        displayName: item.author_display_name || item.author_name,
        avatarUrl: item.author_avatar_url ?? null,
        verified: !!item.author_verified,
        claimed: false,
        followerCount: 0,
        articleCount: 0,
      },
      // get_feed does not return categories or rating_count.
      categories: [],
      stats: {
        likeCount: item.like_count || 0,
        bookmarkCount: item.bookmark_count || 0,
        commentCount: item.comment_count || 0,
        shareCount: item.share_count || 0,
        ratingCount: 0,
        avgRating: item.avg_rating || 0,
      },
      featured: !!item.featured,
      publishedAt: item.published_at,
      indexedAt: null,
      readTimeMin: item.read_time_min,
    },
    cursor: encodeCursor(item.published_at),
    score: item.score,
  }));

  return {
    edges,
    pageInfo: {
      hasNextPage,
      hasPreviousPage: false,
      startCursor: edges[0]?.cursor || null,
      endCursor: lastRow ? encodeCursor(lastRow.published_at) : null,
    },
    totalCount: edges.length,
  };
}

// search_articles returns flat rows (author_handle, like_count, ...). Shape
// them like feed nodes so the Article type's non-null fields resolve.
export function transformSearchRow(row: any): any {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    xUrl: row.x_url,
    coverImageUrl: row.cover_image_url,
    readTimeMin: row.read_time_min,
    featured: false,
    publishedAt: row.published_at,
    indexedAt: null,
    // search_articles has no author id column, so Author.id (and
    // Author.articles, which needs it) cannot resolve for search results.
    author: {
      handle: row.author_handle,
      displayName: row.author_display_name || row.author_handle,
      avatarUrl: null,
      verified: !!row.author_verified,
      claimed: false,
      followerCount: 0,
      articleCount: 0,
    },
    categories: [],
    stats: {
      likeCount: row.like_count || 0,
      bookmarkCount: 0,
      commentCount: 0,
      shareCount: 0,
      ratingCount: 0,
      avgRating: 0,
    },
  };
}

// For offset-paged lists (search, trending). rows holds up to limit + 1
// items; the extra one only signals hasNextPage. Cursors are positions in the
// unfiltered list so hidden rows can't shift or stall pagination.
function formatOffsetConnection<R extends { title?: string | null }>(
  rows: R[],
  limit: number,
  offset: number,
  toNode: (row: R) => any,
) {
  const hasNextPage = rows.length > limit;
  const page = rows.slice(0, limit);
  const positioned = page.map((row, i) => ({ row, title: row.title, position: offset + i + 1 }));
  const edges = filterBlockedTitles(positioned).map(({ row, position }) => ({
    node: toNode(row),
    cursor: encodeOffsetCursor(position),
  }));
  return {
    edges,
    pageInfo: {
      hasNextPage,
      hasPreviousPage: offset > 0,
      startCursor: edges[0]?.cursor || null,
      // From the unfiltered page so hidden rows can't stall pagination.
      endCursor: page.length ? encodeOffsetCursor(offset + page.length) : null,
    },
    totalCount: edges.length,
  };
}

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
