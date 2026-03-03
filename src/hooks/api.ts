/**
 * Byline API Hooks
 * 
 * Lightweight hooks wrapping fetch() to the GraphQL endpoint.
 * No Apollo Client dependency at MVP — keeps the bundle small.
 * Swap in @apollo/client or urql when we need caching/subscriptions.
 */

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient } from '@/lib/supabase-browser';

const GQL_ENDPOINT = '/api/graphql';

// ─── Core GraphQL Fetch ──────────────────────────────────────

async function gql<T = any>(
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const supabase = createBrowserClient();
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(GQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token && {
        Authorization: `Bearer ${session.access_token}`,
      }),
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

// ─── Feed Hook ───────────────────────────────────────────────

interface UseFeedOptions {
  category?: string;
  sort?: 'FOR_YOU' | 'LATEST' | 'POPULAR';
  search?: string;
  pageSize?: number;
}

export function useFeed(options: UseFeedOptions = {}) {
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [endCursor, setEndCursor] = useState<string | null>(null);

  const fetchFeed = useCallback(async (cursor?: string) => {
    try {
      setLoading(true);
      const data = await gql(`
        query Feed($first: Int, $after: String, $category: String, $sort: FeedSort, $search: String) {
          articles(first: $first, after: $after, category: $category, sort: $sort, search: $search) {
            edges {
              node {
                id
                title
                excerpt
                xUrl
                readTimeMin
                featured
                publishedAt
                viewerHasLiked
                viewerHasBookmarked
                author {
                  handle
                  displayName
                  avatarUrl
                  verified
                }
                categories { slug label }
                stats { likeCount bookmarkCount commentCount shareCount avgRating }
              }
              cursor
              score
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `, {
        first: options.pageSize || 20,
        after: cursor || null,
        category: options.category || null,
        sort: options.sort || 'FOR_YOU',
        search: options.search || null,
      });

      const newArticles = data.articles.edges.map((e: any) => ({
        ...e.node,
        _score: e.score,
        _cursor: e.cursor,
      }));

      if (cursor) {
        setArticles(prev => [...prev, ...newArticles]);
      } else {
        setArticles(newArticles);
      }

      setHasNextPage(data.articles.pageInfo.hasNextPage);
      setEndCursor(data.articles.pageInfo.endCursor);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [options.category, options.sort, options.search, options.pageSize]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  const loadMore = useCallback(() => {
    if (hasNextPage && endCursor) fetchFeed(endCursor);
  }, [hasNextPage, endCursor, fetchFeed]);

  return { articles, loading, error, hasNextPage, loadMore, refetch: () => fetchFeed() };
}

// ─── Single Article Hook ─────────────────────────────────────

export function useArticle(id: string) {
  const [article, setArticle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await gql(`
          query Article($id: UUID!) {
            article(id: $id) {
              id title excerpt bodyPreview xUrl readTimeMin featured publishedAt
              viewerHasLiked viewerHasBookmarked viewerRating
              author { id handle displayName avatarUrl bio verified claimed followerCount articleCount }
              categories { slug label }
              stats { likeCount bookmarkCount commentCount shareCount ratingCount avgRating }
            }
          }
        `, { id });
        setArticle(data.article);
        setError(null);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  return { article, loading, error };
}

// ─── Engagement Mutations ────────────────────────────────────

export function useEngagement() {
  const like = useCallback(async (articleId: string) => {
    return gql(`mutation($id: UUID!) { likeArticle(articleId: $id) { id stats { likeCount } viewerHasLiked } }`, { id: articleId });
  }, []);

  const unlike = useCallback(async (articleId: string) => {
    return gql(`mutation($id: UUID!) { unlikeArticle(articleId: $id) { id stats { likeCount } viewerHasLiked } }`, { id: articleId });
  }, []);

  const bookmark = useCallback(async (articleId: string) => {
    return gql(`mutation($id: UUID!) { bookmarkArticle(articleId: $id) { id stats { bookmarkCount } viewerHasBookmarked } }`, { id: articleId });
  }, []);

  const removeBookmark = useCallback(async (articleId: string) => {
    return gql(`mutation($id: UUID!) { removeBookmark(articleId: $id) { id stats { bookmarkCount } viewerHasBookmarked } }`, { id: articleId });
  }, []);

  const rate = useCallback(async (articleId: string, score: number) => {
    return gql(`mutation($id: UUID!, $score: Int!) { rateArticle(articleId: $id, score: $score) { id stats { avgRating ratingCount } viewerRating } }`, { id: articleId, score });
  }, []);

  return { like, unlike, bookmark, removeBookmark, rate };
}

// ─── Submit Article ──────────────────────────────────────────

export function useSubmitArticle() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (url: string, categoryId?: string, notes?: string) => {
    try {
      setSubmitting(true);
      setError(null);
      const data = await gql(`
        mutation Submit($input: SubmitArticleInput!) {
          submitArticle(input: $input) { id url status createdAt }
        }
      `, { input: { url, categoryId, notes } });
      return data.submitArticle;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { submit, submitting, error };
}

// ─── Auth Hook ───────────────────────────────────────────────

export function useAuth() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createBrowserClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user || null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  }, []);

  const signInWithX = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'twitter',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return { user, loading, signInWithEmail, signUp, signInWithX, signOut };
}
