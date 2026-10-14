import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ArticleTime } from './article-time';
import { timeAgo } from '@/lib/format';
import type { FeedArticle } from '@/lib/home-feed';

vi.mock('@/hooks/api', () => ({ gql: vi.fn(), useAuth: () => ({ user: null }) }));
vi.mock('@/components/ads/monetag', () => ({
  FeedWithAds: ({ articles }: { articles: React.ReactNode[] }) => <>{articles}</>, NativeAd: () => null,
}));
vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
import { HomeFeed } from './home-feed';

let view: ReactTestRenderer | undefined;
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.stubEnv('TZ', 'UTC'); });
afterEach(async () => {
  await act(async () => { view?.unmount(); }); view = undefined;
  vi.useRealTimers(); vi.unstubAllEnvs();
});
const publishedAt = '2026-10-14T00:00:00Z';
const text = () => view!.root.findByType('time').children.join('');

describe('ArticleTime hydration boundary', () => {
  it.each([
    ['2026-10-14T00:00:59Z', '2026-10-14T00:01:01Z'],
    ['2026-10-14T00:59:59Z', '2026-10-14T01:00:01Z'],
    ['2026-10-14T23:59:59Z', '2026-10-15T00:00:01Z'],
    ['2026-10-20T23:59:59Z', '2026-10-21T00:00:01Z'],
  ])('keeps first-render HTML stable across ISR clock drift from %s to %s', (serverTime, clientTime) => {
    vi.setSystemTime(new Date(serverTime));
    const serverHtml = renderToString(<ArticleTime publishedAt={publishedAt} />);
    const oldServerLabel = timeAgo(publishedAt);
    vi.setSystemTime(new Date(clientTime));
    expect(timeAgo(publishedAt)).not.toBe(oldServerLabel); // proves the prior mismatch
    expect(renderToString(<ArticleTime publishedAt={publishedAt} />)).toBe(serverHtml);
    expect(serverHtml).toContain('>Oct 14</time>');
  });

  it('uses the same initial UTC date across server/browser timezone differences', () => {
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
    const date = '2026-10-01T00:30:00Z';
    const server = renderToString(<ArticleTime publishedAt={date} />);
    expect(timeAgo(date)).toBe('Oct 1');
    vi.stubEnv('TZ', 'America/Los_Angeles');
    expect(timeAgo(date)).toBe('Sep 30'); // same timestamp, different old fallback
    expect(renderToString(<ArticleTime publishedAt={date} />)).toBe(server);
  });

  it('uses deterministic text on the first client render, then current relative time after effects', async () => {
    vi.setSystemTime(new Date('2026-10-14T02:10:00Z'));
    view = create(<ArticleTime publishedAt={publishedAt} />);
    expect(text()).toBe('Oct 14');
    expect(view.root.findByType('time').props.dateTime).toBe(publishedAt);
    await act(async () => {});
    expect(text()).toBe('2h');
    vi.setSystemTime(new Date('2026-10-14T03:10:00Z'));
    await act(async () => { view!.update(<ArticleTime publishedAt={publishedAt} />); });
    expect(text()).toBe('3h');
  });

  it('preserves local calendar display after hydration and responds to changed date props', async () => {
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z')); vi.stubEnv('TZ', 'America/Los_Angeles');
    await act(async () => { view = create(<ArticleTime publishedAt="2026-10-01T00:30:00Z" />); });
    expect(text()).toBe('Sep 30');
    await act(async () => { view!.update(<ArticleTime publishedAt="2026-10-14T11:00:00Z" />); });
    expect(text()).toBe('1h');
    expect(view!.root.findByType('time').props.dateTime).toBe('2026-10-14T11:00:00Z');
  });

  it('keeps the real homepage/card tree deterministic while retaining machine-readable dates', () => {
    const article: FeedArticle = {
      id: 'synthetic', title: 'Article', excerpt: null, coverImageUrl: null, readTimeMin: null,
      featured: false, publishedAt, authorHandle: 'author', authorName: 'Author',
      authorVerified: false, likeCount: 1, bookmarkCount: 0,
    };
    const feed = <HomeFeed initialArticles={[article]} initialHasNext={false} initialCursor={null} />;
    vi.setSystemTime(new Date('2026-10-14T00:59:59Z'));
    const serverHtml = renderToString(feed);
    vi.setSystemTime(new Date('2026-10-14T01:15:00Z')); vi.stubEnv('TZ', 'America/Los_Angeles');
    expect(renderToString(feed)).toBe(serverHtml);
    expect(serverHtml).toContain('<time dateTime="2026-10-14T00:00:00Z">Oct 14</time>');
  });
});
