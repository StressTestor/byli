import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ article: null as any, error: null as any, queries: 0, filters: [] as unknown[], options: null as any, render: vi.fn(), noStore: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: (_url: string, _key: string, options: unknown) => {
  state.options = options;
  return { from: () => { const builder: any = {
    select: () => builder, eq: (...filter: unknown[]) => { state.filters.push(filter); return builder; },
    single: async () => { state.queries++; return { data: state.article, error: state.error }; },
  }; return builder; } };
} }));
vi.mock('next/cache', () => ({ unstable_noStore: state.noStore }));
vi.mock('@/lib/article-og', () => ({ getArticleOgBytes: (...args: unknown[]) => state.render(...args) }));
import Image, { runtime, dynamic } from './opengraph-image';
const call = () => Image({ params: Promise.resolve({ id: 'article-id' }) });
beforeEach(() => {
  state.article = { title: 'Visible title', author: { display_name: 'Name', handle: 'handle' }, categories: [{ category: { label: 'Category' } }] };
  state.error = null; state.queries = 0; state.filters = []; state.noStore.mockClear();
  state.render.mockReset().mockImplementation(async source => Buffer.from(JSON.stringify(source)));
});
describe('live article visibility before raster cache', () => {
  it('uses Node dynamic execution and private/no-store headers', async () => {
    const response = await call(); expect(runtime).toBe('nodejs'); expect(dynamic).toBe('force-dynamic');
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0, must-revalidate');
    expect(response.headers.get('content-type')).toBe('image/png'); expect(state.noStore).toHaveBeenCalledOnce();
  });
  it('explicitly disables caching for the dedicated publication DB fetch', async () => {
    const fetchMock = vi.fn(async () => new Response('{}')); vi.stubGlobal('fetch', fetchMock);
    try { await state.options.global.fetch('https://example.test', { cache: 'force-cache' }); expect(fetchMock).toHaveBeenCalledWith('https://example.test', { cache: 'no-store' }); }
    finally { vi.unstubAllGlobals(); }
  });
  it('rechecks published visibility on every request and immediately hides deleted/unpublished data', async () => {
    expect(await (await call()).text()).toContain('Visible title'); state.article = null;
    const body = await (await call()).text(); expect(body).not.toContain('Visible title'); expect(body).not.toContain('handle');
    expect(body).toContain('Article Not Found'); expect(state.queries).toBe(2);
    expect(state.filters).toContainEqual(['id', 'article-id']); expect(state.filters).toContainEqual(['status', 'published']);
  });
  it('passes current edited display fields to renderer', async () => {
    await call(); state.article.title = 'Edited'; state.article.author.handle = 'newhandle'; await call();
    expect(state.render.mock.calls[1][0]).toMatchObject({ title: 'Edited', authorHandle: 'newhandle' });
  });
  it('fails closed on publication query errors without using returned stale data', async () => {
    state.error = { message: 'DB failed' }; const body = await (await call()).text();
    expect(body).toContain('Article Not Found'); expect(body).not.toContain('Visible title');
  });
});
