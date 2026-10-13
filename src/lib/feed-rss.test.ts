import { describe, it, expect, vi } from 'vitest';

// A get_feed row exactly as the live function returns it (captured from
// production 2026-10-13). The feed routes must render this shape.
const LIVE_ROW = {
  id: '17679a22-0513-4481-a219-2f667ff00d98',
  score: 0.16,
  title: 'Post-Christian America',
  x_url: 'https://x.com/brianchau57/status/2102553995709403240',
  source: 'twitterapi',
  excerpt: 'What did you think Post-Christian America meant?',
  featured: false,
  author_id: 'a207aef2-42bb-4e82-8b97-463d46ac0bb3',
  avg_rating: 0,
  like_count: 6,
  share_count: 0,
  published_at: '2026-09-23T00:21:50+00:00',
  author_handle: 'brianchau57',
  comment_count: 1,
  read_time_min: 2,
  bookmark_count: 4,
  author_verified: true,
  cover_image_url: 'https://pbs.twimg.com/media/x.jpg',
  author_avatar_url: 'https://pbs.twimg.com/profile_images/x.jpg',
  author_display_name: 'Brian Chau',
};

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { rpc, from: vi.fn() } }));

import { fetchLatestArticles, generateRSS, generateAtom, generateJSONFeed } from './feed';

const META = { title: 'Linkdrift', description: 'd', path: '/feed.xml' };

describe('feeds render live get_feed rows', () => {
  it('maps id and author display name from the live shape', async () => {
    rpc.mockResolvedValueOnce({ data: [LIVE_ROW], error: null });
    const [item] = await fetchLatestArticles();
    expect(item).toMatchObject({
      id: LIVE_ROW.id,
      author_handle: 'brianchau57',
      author_name: 'Brian Chau',
      category_slugs: [],
    });
  });

  it('RSS, Atom and JSON generate without throwing', async () => {
    rpc.mockResolvedValueOnce({ data: [LIVE_ROW], error: null });
    const items = await fetchLatestArticles();
    const rss = generateRSS(items, META);
    expect(rss).toContain(`<link>https://linkdrift.app/article/${LIVE_ROW.id}</link>`);
    expect(rss).toContain('(Brian Chau)');
    expect(() => generateAtom(items, META)).not.toThrow();
    expect(generateJSONFeed(items, META)).toBeTruthy();
  });

  it('falls back to the handle when the display name is missing', async () => {
    rpc.mockResolvedValueOnce({ data: [{ ...LIVE_ROW, author_display_name: null }], error: null });
    const [item] = await fetchLatestArticles();
    expect(item.author_name).toBe('brianchau57');
    expect(() => generateRSS([item], META)).not.toThrow();
  });
});
