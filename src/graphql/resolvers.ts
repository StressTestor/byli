import { supabaseAdmin } from '@/lib/supabase-admin';
import { createSupabaseServer } from '@/lib/supabase-server';
import type { FeedSort, Timeframe, ArticleWithRelations } from '@/types/database';

// ─── Helpers ─────────────────────────────────────────────────

function encodeCursor(date: string): string {
  return Buffer.from(date).toString('base64');
}

function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64').toString('utf-8');
}

function sortMap(sort: string): string {
  switch (sort) {
    case 'FOR_YOU': return 'foryou';
    case 'LATEST': return 'latest';
    case 'POPULAR': return 'popular';
    case 'TOP_RATED': return 'top_rated';
    default: return 'foryou';
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

      // Use search function if search query provided
      if (args.search) {
        const { data, error } = await supabaseAdmin.rpc('search_articles', {
          query: args.search,
          lim: limit + 1,
          off_set: 0, // TODO: cursor-based for search
        });
        if (error) throw new Error(error.message);
        return formatConnection(data || [], limit);
      }

      // Use feed function for standard queries
      const { data, error } = await supabaseAdmin.rpc('get_feed', {
        p_category_slug: args.category || null,
        p_sort: sortKey,
        p_limit: limit + 1, // fetch one extra to determine hasNextPage
        p_cursor: cursor,
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

    // Trending articles
    trending: async (_: any, args: { timeframe?: string; first?: number; after?: string }) => {
      const limit = Math.min(args.first || 20, 50);
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
        .limit(limit);

      if (error) throw new Error(error.message);
      return formatConnection((data || []).map(transformArticle), limit);
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

      return (data || []).map(cat => ({
        ...cat,
        articleCount: countMap[cat.id] || 0,
      }));
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
      return { ...data, id: user.id };
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

      if (args.status) query = query.eq('status', args.status.toLowerCase());

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data || [];
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
      return data;
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
      return data;
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
      return { ...data, key: rawKey };
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
    categories: raw.categories?.map((ac: any) => ac.category || ac) || [],
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
    featured: raw.featured,
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
    verified: raw.verified,
    claimed: raw.claimed,
    followerCount: raw.follower_count || 0,
    articleCount: raw.article_count || 0,
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
    totalCount: edges.length, // approximate; exact count is expensive
  };
}

function formatFeedConnection(items: any[], limit: number) {
  const hasNextPage = items.length > limit;
  const edges = items.slice(0, limit).map(item => ({
    node: {
      id: item.article_id,
      title: item.title,
      excerpt: item.excerpt,
      xUrl: item.x_url,
      author: {
        handle: item.author_handle,
        displayName: item.author_name,
        verified: item.author_verified,
      },
      categories: item.category_slugs || [],
      stats: {
        likeCount: item.like_count,
        bookmarkCount: item.bookmark_count,
        avgRating: item.avg_rating,
      },
      featured: item.featured,
      publishedAt: item.published_at,
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
      endCursor: edges[edges.length - 1]?.cursor || null,
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
