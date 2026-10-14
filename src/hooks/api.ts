/**
 * Linkdrift API Hooks
 *
 * Lightweight hooks wrapping fetch() to the GraphQL endpoint.
 * No Apollo Client dependency at MVP — keeps the bundle small.
 * Swap in @apollo/client or urql when we need caching/subscriptions.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createBrowserClient } from '@/lib/supabase-browser';
import { appendUniqueArticles, FEED_LOAD_ERROR, readFeedConnection } from '@/lib/feed-client';

const GQL_ENDPOINT = '/api/graphql';

// ─── Core GraphQL Fetch ──────────────────────────────────────

export async function gql<T = any>(
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Only attach auth header if Supabase env vars are configured
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createBrowserClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
    } catch {
      // Auth unavailable, proceed without token
    }
  }

  const res = await fetch(GQL_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  // Never render raw proxy responses or database diagnostics in client UI.
  if (!res.ok) throw new Error('Could not complete the request. Please try again.');
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('Could not complete the request. Please try again.');
  }
  if (!json || typeof json !== 'object' || json.errors?.length || json.data == null) {
    throw new Error('Could not complete the request. Please try again.');
  }
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [endCursor, setEndCursor] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const loadedOptions = useRef<string | null>(null);
  const pending = useRef(false);
  const optionsKey = JSON.stringify([options.category, options.sort, options.search, options.pageSize]);
  const currentOptions = useRef(optionsKey);
  currentOptions.current = optionsKey;

  const fetchFeed = useCallback(async (cursor?: string) => {
    if (cursor && pending.current) return;
    const version = ++requestVersion.current;
    const requestedOptions = optionsKey;
    const isCurrent = () => version === requestVersion.current && requestedOptions === currentOptions.current;
    pending.current = true;
    setError(null);
    try {
      if (cursor) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setLoadingMore(false);
        if (loadedOptions.current !== requestedOptions) {
          setArticles([]);
          setHasNextPage(false);
          setEndCursor(null);
        }
        setError(null);
      }

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
        sort: options.sort || 'POPULAR',
        search: options.search || null,
      });

      if (!isCurrent()) return;
      const connection = readFeedConnection(data.articles);
      const newArticles = connection.edges.map((e) => ({
        ...e.node,
        _score: e.score,
        _cursor: e.cursor,
      }));

      if (cursor) {
        setArticles(prev => appendUniqueArticles(prev, newArticles));
      } else {
        setArticles(newArticles);
      }

      loadedOptions.current = requestedOptions;
      setHasNextPage(connection.pageInfo.hasNextPage);
      setEndCursor(connection.pageInfo.endCursor);
      setError(null);
    } catch {
      if (!isCurrent()) return;
      setError(FEED_LOAD_ERROR);
      if (!cursor && loadedOptions.current !== requestedOptions) {
        setHasNextPage(false);
        setEndCursor(null);
      }
    } finally {
      if (isCurrent()) {
        pending.current = false;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [options.category, options.sort, options.search, options.pageSize, optionsKey]);

  useEffect(() => {
    fetchFeed();
    return () => { requestVersion.current += 1; pending.current = false; };
  }, [fetchFeed]);

  const loadMore = useCallback(() => {
    if (hasNextPage && endCursor && !loading && !loadingMore) fetchFeed(endCursor);
  }, [hasNextPage, endCursor, loading, loadingMore, fetchFeed]);

  return { articles, loading, loadingMore, error, hasNextPage, loadMore, refetch: () => fetchFeed() };
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
    let active = true;
    let authEventReceived = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (!active) return;
      authEventReceived = true;
      setUser(session?.user || null);
      setLoading(false);
    });
    // A newer sign-out/account-switch event takes precedence over the initial
    // session lookup, even when that older request finishes later.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active || authEventReceived) return;
      setUser(session?.user || null);
      setLoading(false);
    }).catch(() => {
      if (!active || authEventReceived) return;
      setUser(null);
      setLoading(false);
    });
    return () => { active = false; subscription.unsubscribe(); };
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
