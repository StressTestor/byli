import { describe, it, expect, vi, beforeEach } from 'vitest';

// get_feed only recognizes uppercase sort keys; lowercase silently falls back
// to the FOR_YOU score ordering. Guard every get_feed caller.
const rpc = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: [], error: null })));

vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { rpc, from: vi.fn() } }));
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServer: vi.fn() }));

import { fetchLatestArticles, fetchCategoryArticles } from './feed';
import { getHomeFeed, FEED_SORTS } from './home-feed';
import { resolvers } from '@/graphql/resolvers';

beforeEach(() => rpc.mockClear());

function sortsPassedToGetFeed(): string[] {
  return (rpc.mock.calls as any[])
    .filter(([fn]) => fn === 'get_feed')
    .map(([, args]) => args.p_sort);
}

describe('get_feed sort keys', () => {
  it('RSS/Atom/JSON fetchers ask for LATEST', async () => {
    await fetchLatestArticles();
    await fetchCategoryArticles('tech');
    expect(sortsPassedToGetFeed()).toEqual(['LATEST', 'LATEST']);
  });

  it('every caller passes a recognized key', async () => {
    await getHomeFeed({ sort: 'LATEST' });
    await resolvers.Query.articles(null, { sort: 'TOP_RATED' });
    await resolvers.Query.articles(null, {});
    for (const s of sortsPassedToGetFeed()) {
      expect(FEED_SORTS).toContain(s);
    }
  });
});

describe('GraphQL search', () => {
  it('calls search_articles with the live parameter names and shapes nodes', async () => {
    rpc.mockImplementationOnce(() => Promise.resolve({
      data: [
        { id: 'a1', title: 'One', excerpt: 'e', x_url: 'u', cover_image_url: null, read_time_min: 3,
          published_at: '2026-01-01T00:00:00Z', author_handle: 'h', author_display_name: 'H',
          author_verified: true, like_count: 4, relevance: 0.5 },
        { id: 'a2', title: 'Two', x_url: 'u2', author_handle: 'h2', like_count: 0 },
      ],
      error: null,
    }) as any);
    const conn = await resolvers.Query.articles(null, { search: 'ai', first: 1 });
    expect(rpc).toHaveBeenCalledWith('search_articles', { p_query: 'ai', p_limit: 2, p_offset: 0 });
    expect(conn.edges).toHaveLength(1);
    expect(conn.edges[0].node).toMatchObject({
      id: 'a1', xUrl: 'u', author: { handle: 'h', displayName: 'H', verified: true },
      stats: { likeCount: 4 },
    });
    expect(conn.pageInfo.hasNextPage).toBe(true);

    rpc.mockClear();
    await resolvers.Query.articles(null, { search: 'ai', first: 1, after: conn.pageInfo.endCursor! });
    expect(rpc).toHaveBeenCalledWith('search_articles', { p_query: 'ai', p_limit: 2, p_offset: 1 });
  });
});
