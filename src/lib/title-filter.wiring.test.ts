import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every wiring test reads from this mock: rpc() for get_feed, from() for the
// trending query builder chain.
const state = vi.hoisted(() => ({ rpcRows: [] as any[], tableRows: [] as any[] }));

vi.mock('@/lib/supabase-admin', () => {
  const builder: any = {};
  for (const m of ['select', 'eq', 'gte', 'order']) builder[m] = vi.fn(() => builder);
  builder.limit = vi.fn(() => Promise.resolve({ data: state.tableRows, error: null }));
  return {
    supabaseAdmin: {
      rpc: vi.fn(() => Promise.resolve({ data: state.rpcRows, error: null })),
      from: vi.fn(() => builder),
    },
  };
});
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServer: vi.fn() }));

import { getHomeFeed, getTrending } from './home-feed';
import { resolvers } from '@/graphql/resolvers';

const BAD = 'A retarded take';

function feedRow(id: string, title: string, published_at: string) {
  return { id, title, published_at };
}

beforeEach(() => {
  state.rpcRows = [];
  state.tableRows = [];
});

describe('getHomeFeed', () => {
  it('hides blocked titles and keeps the cursor from the unfiltered page', async () => {
    state.rpcRows = [
      feedRow('1', 'Good one', '2026-01-03T00:00:00Z'),
      feedRow('2', BAD, '2026-01-02T00:00:00Z'),
      feedRow('3', 'Extra row', '2026-01-01T00:00:00Z'),
    ];
    const page = await getHomeFeed({ pageSize: 2 });
    expect(page.articles.map((a) => a.id)).toEqual(['1']);
    expect(page.hasNextPage).toBe(true);
    expect(page.endCursor).toBe('2026-01-02T00:00:00Z');
  });
});

describe('getTrending', () => {
  it('hides blocked titles and still fills the panel', async () => {
    state.tableRows = [
      { id: '1', title: BAD, authors: { handle: 'a' }, article_stats: { like_count: 9 } },
      { id: '2', title: 'Two', authors: { handle: 'b' }, article_stats: { like_count: 8 } },
      { id: '3', title: 'Three', authors: { handle: 'c' }, article_stats: { like_count: 7 } },
    ];
    const items = await getTrending(2);
    expect(items.map((i) => i.id)).toEqual(['2', '3']);
  });
});

describe('GraphQL articles resolver', () => {
  it('hides blocked titles and keeps the cursor from the unfiltered page', async () => {
    state.rpcRows = [
      feedRow('1', 'Good one', '2026-01-03T00:00:00Z'),
      feedRow('2', BAD, '2026-01-02T00:00:00Z'),
      feedRow('3', 'Extra row', '2026-01-01T00:00:00Z'),
    ];
    const conn = await resolvers.Query.articles(null, { first: 2 });
    expect(conn.edges.map((e: any) => e.node.id)).toEqual(['1']);
    expect(conn.pageInfo.hasNextPage).toBe(true);
    expect(Buffer.from(conn.pageInfo.endCursor!, 'base64').toString()).toBe('2026-01-02T00:00:00Z');
  });

  it('still advances when every item on the page is hidden', async () => {
    state.rpcRows = [
      feedRow('1', BAD, '2026-01-03T00:00:00Z'),
      feedRow('2', 'Extra row', '2026-01-02T00:00:00Z'),
    ];
    const conn = await resolvers.Query.articles(null, { first: 1 });
    expect(conn.edges).toEqual([]);
    expect(conn.pageInfo.hasNextPage).toBe(true);
    expect(conn.pageInfo.endCursor).not.toBeNull();
  });
});

describe('GraphQL trending resolver', () => {
  it('hides blocked titles', async () => {
    state.tableRows = [
      { id: '1', title: BAD, published_at: '2026-01-02T00:00:00Z' },
      { id: '2', title: 'Fine', published_at: '2026-01-01T00:00:00Z' },
    ];
    const conn = await resolvers.Query.trending(null, {});
    expect(conn.edges.map((e: any) => e.node.id)).toEqual(['2']);
  });
});

describe('RSS/Atom/JSON feed fetchers', () => {
  it('hides blocked titles', async () => {
    const { fetchLatestArticles } = await import('./feed');
    state.rpcRows = [
      { article_id: '1', title: BAD, published_at: '2026-01-02T00:00:00Z' },
      { article_id: '2', title: 'Fine', published_at: '2026-01-01T00:00:00Z' },
    ];
    const items = await fetchLatestArticles();
    expect(items.map((i) => i.id)).toEqual(['2']);
  });
});
