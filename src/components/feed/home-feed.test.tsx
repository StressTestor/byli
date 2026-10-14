import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { FeedArticle } from '@/lib/home-feed';

const gql = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/api', () => ({ gql, useAuth: () => ({ user: { id: 'user' } }) }));
vi.mock('@/components/ads/monetag', () => ({
  FeedWithAds: ({ articles }: { articles: React.ReactNode[] }) => <>{articles}</>, NativeAd: () => null,
}));
vi.mock('./article-card', () => ({
  ArticleCard: ({ article }: { article: FeedArticle }) => <article data-id={article.id}>{article.title}</article>,
}));
import { HomeFeed } from './home-feed';

function article(id: number): FeedArticle {
  return {
    id: String(id), title: `Article ${id}`, excerpt: null, coverImageUrl: null,
    readTimeMin: null, featured: false, publishedAt: '2026-10-13T00:00:00Z',
    authorHandle: 'author', authorName: 'Author', authorVerified: false, likeCount: 1, bookmarkCount: 0,
  };
}
function response(ids: number[], cursor = 'next-page', hasNextPage = true) {
  return { articles: { edges: ids.map((id) => ({ node: article(id) })), pageInfo: { endCursor: cursor, hasNextPage } } };
}
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
function button(view: ReactTestRenderer, label: string) {
  return view.root.findAllByType('button').find((b) => b.children.join('') === label)!;
}
function cards(view: ReactTestRenderer) {
  return view.root.findAllByType('article').map((a) => a.props['data-id']);
}
async function render() {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<HomeFeed initialArticles={Array.from({ length: 19 }, (_, i) => article(i + 1))}
      initialHasNext initialCursor="ssr-cursor" />);
  });
  return view;
}

beforeEach(() => gql.mockReset());

describe('HomeFeed recovery and request ordering', () => {
  it('keeps all 19 SSR cards on Load more failure, sanitizes errors, and retries the unchanged cursor', async () => {
    const view = await render();
    gql.mockRejectedValueOnce(new Error('secret database connection diagnostics'));
    await act(async () => { await button(view, 'Load more').props.onClick(); });
    expect(cards(view)).toHaveLength(19);
    expect(view.root.findByProps({ role: 'alert' }).children[0]).toBeTruthy();
    expect(JSON.stringify(view.toJSON())).not.toContain('secret database');
    expect(button(view, 'Retry load more')).toBeDefined();

    // Live engagement changes can overlap pages; each card remains unique.
    gql.mockResolvedValueOnce(response([19, 20, 20, 21], 'page-3', false));
    await act(async () => { await button(view, 'Retry load more').props.onClick(); });
    expect(cards(view)).toEqual(Array.from({ length: 21 }, (_, i) => String(i + 1)));
    expect(gql.mock.calls.map(([, variables]) => variables.after)).toEqual(['ssr-cursor', 'ssr-cursor']);
    expect(view.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    expect(button(view, 'Load more')).toBeUndefined();
  });

  it('rejects malformed page metadata before changing any cards or cursor', async () => {
    const view = await render();
    gql.mockResolvedValueOnce({ articles: { edges: [{ node: article(42) }] } });
    await act(async () => { await button(view, 'Load more').props.onClick(); });
    expect(cards(view)).toHaveLength(19);
    expect(button(view, 'Retry load more')).toBeDefined();
  });

  it('blocks repeated Load more clicks before React commits loading state', async () => {
    const view = await render();
    const pending = deferred();
    gql.mockReturnValueOnce(pending.promise);
    await act(async () => {
      const click = button(view, 'Load more').props.onClick;
      void click(); void click();
    });
    expect(gql).toHaveBeenCalledTimes(1);
    expect(cards(view)).toHaveLength(19);
    await act(async () => { pending.resolve(response([20])); });
    expect(cards(view)).toHaveLength(20);
  });

  it('ignores slower old filter responses and keeps the new scope/cursor together', async () => {
    const view = await render();
    const oldFilter = deferred();
    const newFilter = deferred();
    gql.mockReturnValueOnce(oldFilter.promise).mockReturnValueOnce(newFilter.promise);
    await act(async () => { void button(view, 'Latest').props.onClick(); });
    expect(cards(view)).toHaveLength(19);
    await act(async () => { void button(view, 'Tech').props.onClick(); });
    await act(async () => { newFilter.resolve(response([42], 'tech-cursor')); });
    await act(async () => { oldFilter.resolve(response([99], 'stale-cursor')); });
    expect(cards(view)).toEqual(['42']);
    gql.mockResolvedValueOnce(response([43], 'end', false));
    await act(async () => { await button(view, 'Load more').props.onClick(); });
    expect(gql).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
      category: 'tech', sort: 'LATEST', after: 'tech-cursor',
    }));
    expect(cards(view)).toEqual(['42', '43']);
  });

  it('does not append an in-flight old page after changing filters', async () => {
    const view = await render();
    const oldPage = deferred();
    gql.mockReturnValueOnce(oldPage.promise).mockResolvedValueOnce(response([42], 'latest-cursor'));
    await act(async () => { void button(view, 'Load more').props.onClick(); });
    await act(async () => { await button(view, 'Latest').props.onClick(); });
    await act(async () => { oldPage.resolve(response([99], 'stale-cursor')); });
    expect(cards(view)).toEqual(['42']);
    expect(button(view, 'Load more').props.disabled).toBe(false);
  });

  it('preserves the previous filter on failure and offers an explicit filter retry', async () => {
    const view = await render();
    gql.mockRejectedValueOnce(new Error('backend failure'));
    await act(async () => { await button(view, 'Tech').props.onClick(); });
    expect(cards(view)).toHaveLength(19);
    expect(button(view, 'All').props.className).toContain('bg-accent');
    gql.mockResolvedValueOnce(response([42], 'tech-cursor', false));
    await act(async () => { await button(view, 'Retry filter').props.onClick(); });
    expect(gql).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ category: 'tech', after: null }));
    expect(cards(view)).toEqual(['42']);
    expect(view.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  });
});
