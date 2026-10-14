import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
vi.mock('@/lib/supabase-browser', () => ({ createBrowserClient: vi.fn() }));
import { gql, useFeed } from './api';

const fetchMock = vi.fn();
let state: ReturnType<typeof useFeed>;
function Harness({ category }: { category?: string }) {
  state = useFeed({ category });
  return <>{state.articles.map((a) => <article key={a.id}>{a.id}</article>)}</>;
}
function response(ids: number[], cursor = 'next') {
  return { ok: true, json: async () => ({ data: { articles: {
    edges: ids.map((id) => ({ node: { id: String(id) } })),
    pageInfo: { hasNextPage: true, endCursor: cursor },
  } } }) };
}
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('useFeed', () => {
  it('retains loaded cards/cursor after failed pagination or refetch, and clears errors on retry', async () => {
    fetchMock.mockResolvedValueOnce(response([1, 2]));
    let view!: ReactTestRenderer;
    await act(async () => { view = create(<Harness />); });
    fetchMock.mockRejectedValueOnce(new Error('secret connection string'));
    await act(async () => { state.loadMore(); });
    expect(state.articles.map((a) => a.id)).toEqual(['1', '2']);
    expect(state.error).toBe('Could not load articles. Please try again.');
    expect(state.hasNextPage).toBe(true);
    fetchMock.mockResolvedValueOnce(response([2, 3, 3]));
    await act(async () => { state.loadMore(); });
    expect(state.articles.map((a) => a.id)).toEqual(['1', '2', '3']);
    expect(state.error).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).variables.after).toBe('next');
    fetchMock.mockRejectedValueOnce(new Error('refetch failed'));
    await act(async () => { await state.refetch(); });
    expect(state.articles.map((a) => a.id)).toEqual(['1', '2', '3']);
    expect(state.hasNextPage).toBe(true);
    view.unmount();
  });

  it('discards a slow response belonging to an earlier category', async () => {
    let resolveOld!: (value: any) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    let view!: ReactTestRenderer;
    await act(async () => { view = create(<Harness category="tech" />); });
    fetchMock.mockResolvedValueOnce(response([42], 'science-cursor'));
    await act(async () => { view.update(<Harness category="science" />); });
    await act(async () => { resolveOld(response([99], 'old-cursor')); });
    expect(state.articles.map((a) => a.id)).toEqual(['42']);
    fetchMock.mockResolvedValueOnce(response([43]));
    await act(async () => { state.loadMore(); state.loadMore(); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).variables).toMatchObject({ category: 'science', after: 'science-cursor' });
    view.unmount();
  });
});

describe('GraphQL transport errors', () => {
  it.each([
    { ok: false, json: async () => ({ error: 'secret' }) },
    { ok: true, json: async () => { throw new Error('secret HTML body'); } },
    { ok: true, json: async () => ({ errors: [{ message: 'secret SQL diagnostics' }] }) },
    { ok: true, json: async () => ({}) },
    { ok: true, json: async () => null },
  ])('provides a safe recoverable error for failed or malformed responses', async (value) => {
    fetchMock.mockResolvedValueOnce(value);
    await expect(gql('query { articles { totalCount } }')).rejects.toThrow('Could not complete the request. Please try again.');
  });
});
