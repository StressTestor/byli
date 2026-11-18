import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Next 14 uses its compiled canary React for RSC. The app's standalone React
// 18 package lacks cache(). Keep this substitution local to this test module:
// use Next's actual cache implementation, never a home-grown memoization stub.
vi.mock('react', () => require('next/dist/compiled/react'));
const state = vi.hoisted(() => ({
  rows: { articles: new Map<string, Record<string, unknown>>(), authors: new Map<string, Record<string, unknown>>() },
  calls: [] as { table: string; select: string; filters: [string, unknown][] }[],
  error: null as unknown,
}));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: {
  from: (table: 'articles' | 'authors') => {
    const query = { table, select: '', filters: [] as [string, unknown][] };
    const builder = {
      select: (columns: string) => { query.select = columns; return builder; },
      eq: (column: string, value: unknown) => { query.filters.push([column, value]); return builder; },
      single: async () => {
        state.calls.push(query);
        const value = [...state.rows[table].values()].find(row => query.filters.every(([column, expected]) => row[column] === expected));
        return { data: value ? structuredClone(value) : null, error: state.error };
      },
    };
    return builder;
  },
} }));
import { getArticle, getAuthor } from './public-page-data';

// This is the exact cache dispatcher read by the compiled React cache(). A
// fresh root models the boundary installed by RSC for each render request.
const compiledReact = require('next/dist/compiled/react');
const cacheSlot = compiledReact.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentCache;
function request() {
  const roots = new Map<() => unknown, unknown>();
  cacheSlot.current = {
    getCacheForType(factory: () => unknown) {
      if (!roots.has(factory)) roots.set(factory, factory());
      return roots.get(factory);
    },
  };
}
const article = { id: 'article-a', title: 'Original article', status: 'published', body_preview: 'An actual article preview.', author: { display_name: 'Author' }, categories: [], stats: {} };
const author = { id: 'author-a', handle: 'example', display_name: 'Original author', article_count: 2, bio: 'Biography' };
beforeEach(() => {
  state.rows.articles.clear(); state.rows.authors.clear(); state.calls = []; state.error = null;
  state.rows.articles.set(article.id, { ...article }); state.rows.authors.set(author.handle, { ...author });
  request();
});
afterEach(() => { cacheSlot.current = null; });

describe('request-local public page data cache with Next compiled React', () => {
  it('shares the same article promise between concurrent metadata and page reads', async () => {
    const metadata = getArticle(article.id);
    const page = getArticle(article.id);
    expect(metadata).toBe(page);
    expect(await metadata).toMatchObject({ title: article.title, body_preview: article.body_preview });
    expect(await page).toBe(await metadata);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].filters).toEqual([['id', article.id], ['status', 'published']]);
    expect(state.calls[0].select.replace(/\s+/g, '')).toBe('*,author:authors(*),categories:article_categories(category:categories(*)),stats:article_stats(*)');
  });
  it('shares a full author lookup between metadata and page within one request', async () => {
    const metadata = getAuthor(author.handle), page = getAuthor(author.handle);
    expect(metadata).toBe(page);
    expect(await metadata).toMatchObject(author);
    expect(await page).toBe(await metadata);
    expect(state.calls).toEqual([{ table: 'authors', select: '*', filters: [['handle', author.handle]] }]);
  });
  it('separates different article and author arguments inside the same request', async () => {
    state.rows.articles.set('article-b', { ...article, id: 'article-b', title: 'Second' });
    state.rows.authors.set('different', { ...author, id: 'author-b', handle: 'different' });
    const results = await Promise.all([getArticle(article.id), getArticle('article-b'), getAuthor(author.handle), getAuthor('different')]);
    expect(results[0]?.title).toBe('Original article');
    expect(results[1]?.title).toBe('Second');
    expect(results[2]?.handle).toBe('example');
    expect(results[3]?.handle).toBe('different');
    expect(state.calls).toHaveLength(4);
  });
  it('reads changed article content freshly on the next request', async () => {
    expect((await getArticle(article.id))?.title).toBe('Original article');
    state.rows.articles.set(article.id, { ...article, title: 'Corrected article' });
    expect((await getArticle(article.id))?.title).toBe('Original article');
    request();
    expect((await getArticle(article.id))?.title).toBe('Corrected article');
    expect(state.calls).toHaveLength(2);
  });
  it.each(['archived', 'rejected', 'pending', 'deleted'])('never retains a formerly published article after %s on a new request', async status => {
    expect(await getArticle(article.id)).not.toBeNull();
    if (status === 'deleted') state.rows.articles.delete(article.id);
    else state.rows.articles.set(article.id, { ...article, status });
    request();
    expect(await getArticle(article.id)).toBeNull();
    expect(state.calls).toHaveLength(2);
  });
  it('does not retain edited or deleted author data across request boundaries', async () => {
    expect((await getAuthor(author.handle))?.display_name).toBe('Original author');
    state.rows.authors.set(author.handle, { ...author, display_name: 'Updated author', article_count: 3 });
    request();
    expect(await getAuthor(author.handle)).toMatchObject({ display_name: 'Updated author', article_count: 3 });
    state.rows.authors.delete(author.handle);
    request();
    expect(await getAuthor(author.handle)).toBeNull();
    expect(state.calls).toHaveLength(3);
  });
  it('does not cache a missing article into later requests when it becomes published', async () => {
    state.rows.articles.clear();
    expect(await getArticle(article.id)).toBeNull();
    state.rows.articles.set(article.id, { ...article });
    request();
    expect(await getArticle(article.id)).not.toBeNull();
    expect(state.calls).toHaveLength(2);
  });
  it('sanitizes link-only body previews without changing the stored row', async () => {
    const linkOnly = 'https://x.com/example/status/123456789';
    state.rows.articles.set(article.id, { ...article, body_preview: linkOnly });
    expect((await getArticle(article.id))?.body_preview).toBeNull();
    expect(state.rows.articles.get(article.id)?.body_preview).toBe(linkOnly);
  });
  it('does not retain query failures into a fresh request', async () => {
    state.error = { message: 'Temporary database failure' };
    expect(await getArticle(article.id)).toBeNull();
    state.error = null; request();
    expect(await getArticle(article.id)).not.toBeNull();
    expect(state.calls).toHaveLength(2);
  });
  it('does not introduce process-global caching outside the RSC dispatcher', async () => {
    cacheSlot.current = null;
    expect((await getArticle(article.id))?.title).toBe('Original article');
    state.rows.articles.set(article.id, { ...article, title: 'Fresh without dispatcher' });
    expect((await getArticle(article.id))?.title).toBe('Fresh without dispatcher');
    expect(state.calls).toHaveLength(2);
  });
});
