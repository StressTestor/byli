import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeFeedCursor, encodeLegacyFeedCursor, encodeRankedFeedCursor, feedPageSize,
  type RankedFeedCursor,
} from './feed-pagination';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { rpc } }));
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServer: vi.fn() }));
import { getHomeFeed } from './home-feed';
import { resolvers } from '@/graphql/resolvers';

const date = '2026-10-12T01:02:03.123456+00:00';
const scope = { sort: 'POPULAR' as const, category: 'tech' };
const ranked: RankedFeedCursor = {
  version: 2, ...scope, asOf: '2026-10-14T00:00:00.000Z',
  rank: '0.123456789012345678901234567890', publishedAt: date,
  id: '00000000-0000-0000-0000-000000000001',
};

beforeEach(() => {
  vi.unstubAllEnvs();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [], error: null });
});

describe('feed cursor contract', () => {
  it('accepts raw cached SSR and legacy GraphQL timestamps without losing microseconds', () => {
    for (const input of [date, encodeLegacyFeedCursor(date)]) {
      expect(decodeFeedCursor(input, scope)).toEqual({ version: 1, publishedAt: date });
    }
  });

  it('roundtrips ranked scope, null dates, and exact numeric text', () => {
    expect(decodeFeedCursor(encodeRankedFeedCursor(ranked), scope)).toEqual(ranked);
    expect(decodeFeedCursor(encodeRankedFeedCursor({ ...ranked, publishedAt: null }), scope))
      .toEqual({ ...ranked, publishedAt: null });
  });

  it.each(['', 'not a cursor', '2026-nope', '!@#', 'x'.repeat(2049)])('rejects malformed cursor %s', (input) => {
    expect(() => decodeFeedCursor(input, scope)).toThrow('feed link');
  });

  it('rejects reuse across a sort/category, unsupported versions, and malformed keys', () => {
    for (const patch of [
      { sort: 'LATEST' }, { category: null }, { version: 3 }, { id: 'invalid' },
      { rank: 'NaN' }, { rank: '1e100' }, { rank: '1'.repeat(129) }, { publishedAt: 'yesterday' },
    ]) {
      const input = Buffer.from(JSON.stringify({ ...ranked, ...patch })).toString('base64');
      expect(() => decodeFeedCursor(input, scope)).toThrow('feed link');
    }
  });

  it('bounds valid page sizes and rejects zero, negatives, fractions and NaN', () => {
    expect(feedPageSize()).toBe(20);
    expect(feedPageSize(10000)).toBe(50);
    for (const value of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => feedPageSize(value)).toThrow('positive integer');
    }
  });
});

describe('SSR to GraphQL pagination', () => {
  it.each([false, true])('uses the same cursor/backend with v2=%s', async (enabled) => {
    vi.stubEnv('FEED_PAGINATION_V2', String(enabled));
    rpc.mockResolvedValue({ data: [
      { id: ranked.id, title: 'One', published_at: date, cursor_rank: '9' },
      { id: '00000000-0000-0000-0000-000000000002', title: 'Extra', published_at: date, cursor_rank: '8' },
    ], error: null });
    const first = await getHomeFeed({ sort: 'POPULAR', category: 'tech', pageSize: 1 });
    expect(first.hasNextPage).toBe(true);
    expect(first.articles).toHaveLength(1);
    const second = await resolvers.Query.articles(null, {
      sort: 'POPULAR', category: 'tech', first: 1, after: first.endCursor!,
    });
    expect(second.edges).toHaveLength(1);
    expect(rpc).toHaveBeenLastCalledWith(enabled ? 'get_feed_page' : 'get_feed', expect.objectContaining({
      p_limit: 2,
      p_cursor: enabled ? { rank: '9', published_at: date, id: ranked.id } : date,
    }));
  });

  it('defaults to the existing database contract without a migration or probing', async () => {
    await getHomeFeed();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_feed', expect.objectContaining({ p_limit: 21 }));
  });

  it('keeps old cached cursors compatible after v2 activation', async () => {
    vi.stubEnv('FEED_PAGINATION_V2', 'true');
    await resolvers.Query.articles(null, { after: date, sort: 'POPULAR' });
    expect(rpc).toHaveBeenCalledWith('get_feed', expect.objectContaining({ p_cursor: date }));
  });

  it('continues issued v2 cursors after flag rollback', async () => {
    vi.stubEnv('FEED_PAGINATION_V2', 'false');
    await resolvers.Query.articles(null, { ...scope, after: encodeRankedFeedCursor(ranked) });
    expect(rpc).toHaveBeenCalledWith('get_feed_page', expect.objectContaining({ p_as_of: ranked.asOf }));
  });

  it('advances past hidden rows, including an entirely filtered page', async () => {
    vi.stubEnv('FEED_PAGINATION_V2', 'true');
    rpc.mockResolvedValue({ data: [
      { id: ranked.id, title: 'A retarded take', published_at: null, cursor_rank: '0' },
      { id: '00000000-0000-0000-0000-000000000002', title: 'Extra', published_at: null, cursor_rank: '0' },
    ], error: null });
    const page = await getHomeFeed({ ...scope, pageSize: 1 });
    expect(page.articles).toEqual([]);
    expect(page.hasNextPage).toBe(true);
    expect(decodeFeedCursor(page.endCursor, scope)).toMatchObject({ id: ranked.id, publishedAt: null });
  });

  it('never exposes database errors or retries by fetching larger batches', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'secret postgres diagnostics' } });
    await expect(resolvers.Query.articles(null, {})).rejects.toThrow('Could not load articles');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
