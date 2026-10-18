import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from } }));

import ArticlePage, { generateMetadata } from './page';
import { getRelatedArticles } from './related-articles';

interface TestArticle {
  id: string;
  author_id: string;
  status: string;
  title: string;
  published_at: string | null;
  updated_at: string;
  excerpt: string | null;
  body_preview: string | null;
  x_url: string;
  author: { handle: string; display_name: string; verified: boolean };
  categories: Array<{ category: { id: string; label: string; slug: string } }>;
}

function article(id: string, overrides: Partial<TestArticle> = {}): TestArticle {
  return {
    id,
    author_id: 'author-a',
    status: 'published',
    title: `Title ${id}`,
    published_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    excerpt: null,
    body_preview: null,
    x_url: `https://x.com/author_a/status/${id}`,
    author: { handle: 'author_a', display_name: 'Author A', verified: false },
    // Every synthetic article shares a category, including hidden/other-author
    // rows. Those matches must never become a recommendation fallback.
    categories: [{ category: { id: 'tech', label: 'Tech', slug: 'tech' } }],
    ...overrides,
  };
}

let rows: TestArticle[];
let queryError: { message: string } | null;
let rejection: Error | null;
let nullData: boolean;

function makeQuery() {
  const filters: Array<(row: TestArticle) => boolean> = [];
  const orders: Array<{
    field: keyof TestArticle;
    ascending: boolean;
    nullsFirst?: boolean;
  }> = [];

  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(),
    single: vi.fn(),
  };

  query.eq.mockImplementation((field: keyof TestArticle, value: string) => {
    filters.push((row) => row[field] === value);
    return query;
  });
  query.neq.mockImplementation((field: keyof TestArticle, value: string) => {
    filters.push((row) => row[field] !== value);
    return query;
  });
  query.order.mockImplementation((field, options) => {
    orders.push({ field, ...options });
    return query;
  });
  query.limit.mockImplementation(async (limit: number) => {
    if (rejection) throw rejection;
    const data = rows
      .filter((row) => filters.every((filter) => filter(row)))
      .sort((a, b) => {
        for (const { field, ascending, nullsFirst } of orders) {
          const left = a[field];
          const right = b[field];
          if (left === right) continue;
          if (left === null) return nullsFirst ? -1 : 1;
          if (right === null) return nullsFirst ? 1 : -1;
          const comparison = left < right ? -1 : 1;
          return ascending ? comparison : -comparison;
        }
        return 0;
      })
      .slice(0, limit);
    return { data: nullData ? null : data, error: queryError };
  });
  query.single.mockImplementation(async () => ({
    data: rows.find((row) => filters.every((filter) => filter(row))) ?? null,
    error: null,
  }));

  return query;
}

beforeEach(() => {
  rows = [];
  queryError = null;
  rejection = null;
  nullData = false;
  from.mockReset();
  from.mockImplementation((table: string) => {
    // Fail if the former category fallback is reintroduced.
    expect(table).toBe('articles');
    return makeQuery();
  });
});

describe('getRelatedArticles', () => {
  it('returns only published same-author rows, excluding the current article', async () => {
    rows = [
      article('current'),
      article('other-author', { author_id: 'author-b' }),
      article('pending', { status: 'pending' }),
      article('archived', { status: 'archived' }),
      article('rejected', { status: 'rejected' }),
      article('eligible'),
    ];

    const result = await getRelatedArticles('current', 'author-a');

    expect(result.map((row) => row.id)).toEqual(['eligible']);
    expect(from).toHaveBeenCalledTimes(1);
    const query = from.mock.results[0].value;
    expect(query.eq.mock.calls).toEqual([
      ['author_id', 'author-a'],
      ['status', 'published'],
    ]);
    expect(query.neq).toHaveBeenCalledWith('id', 'current');
  });

  it('orders newest first with stable ID ties, puts null dates last, and caps at four', async () => {
    rows = [
      article('null-date', { published_at: null }),
      article('old', { published_at: '2026-09-01T00:00:00Z' }),
      article('tie-b'),
      article('newest', { published_at: '2026-10-02T00:00:00Z' }),
      article('tie-a'),
      article('older', { published_at: '2026-08-01T00:00:00Z' }),
    ];

    const first = await getRelatedArticles('current', 'author-a');
    rows.reverse();
    const second = await getRelatedArticles('current', 'author-a');

    expect(first.map((row) => row.id)).toEqual(['newest', 'tie-a', 'tie-b', 'old']);
    expect(second).toEqual(first);
    const query = from.mock.results[0].value;
    expect(query.order.mock.calls).toEqual([
      ['published_at', { ascending: false, nullsFirst: false }],
      ['id', { ascending: true }],
    ]);
    expect(query.limit).toHaveBeenCalledWith(4);
  });

  it('does not fill an empty result with other authors or hidden category matches', async () => {
    rows = [
      article('current'),
      article('other-author', { author_id: 'author-b' }),
      article('hidden', { status: 'archived' }),
    ];

    expect(await getRelatedArticles('current', 'author-a')).toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('handles a null response as an empty recommendation list', async () => {
    nullData = true;
    expect(await getRelatedArticles('current', 'author-a')).toEqual([]);
  });

  it('discards data returned alongside an error without a fallback query', async () => {
    rows = [article('eligible')];
    queryError = { message: 'lookup unavailable' };

    expect(await getRelatedArticles('current', 'author-a')).toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('handles a rejected lookup without a fallback query', async () => {
    rejection = new Error('connection interrupted');
    expect(await getRelatedArticles('current', 'author-a')).toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
  });
});

describe('article page recommendations', () => {
  it('shows the provider teaser while hiding a stored link-only body from page and metadata', async () => {
    rows = [article('current', { excerpt: 'The provider teaser.', body_preview: 'https://t.co/short' })];

    const html = renderToStaticMarkup(await ArticlePage({ params: Promise.resolve({ id: 'current' }) }));
    const metadata = await generateMetadata({ params: Promise.resolve({ id: 'current' }) });

    expect(html).toContain('The provider teaser.');
    expect(html).not.toContain('https://t.co/short');
    expect(metadata.description).toBe('The provider teaser.');
    expect(metadata.openGraph).toMatchObject({ description: 'The provider teaser.' });
    expect(rows[0].body_preview).toBe('https://t.co/short');
  });

  it('preserves a legitimate short body when no teaser exists', async () => {
    rows = [article('current', { excerpt: null, body_preview: 'A brief but complete note.' })];

    const html = renderToStaticMarkup(await ArticlePage({ params: Promise.resolve({ id: 'current' }) }));
    const metadata = await generateMetadata({ params: Promise.resolve({ id: 'current' }) });

    expect(html).toContain('A brief but complete note.');
    expect(metadata.description).toBe('A brief but complete note.');
  });

  it('renders the existing author heading and only eligible article links', async () => {
    rows = [
      article('current'),
      article('eligible'),
      article('other-author', { author_id: 'author-b' }),
      article('hidden', { status: 'pending' }),
    ];

    const html = renderToStaticMarkup(await ArticlePage({
      params: Promise.resolve({ id: 'current' }),
    }));

    expect(html).toContain('more from ');
    expect(html).toContain('href="/author/author_a"');
    expect(html).toContain('href="/article/eligible"');
    expect(html).not.toContain('href="/article/other-author"');
    expect(html).not.toContain('href="/article/hidden"');
    expect(html).not.toContain('href="/article/current"');
    expect(from).toHaveBeenCalledTimes(2);
  });

  it.each(['empty', 'error', 'rejected'] as const)(
    'keeps the article visible and omits recommendations when lookup is %s',
    async (scenario) => {
      rows = [article('current')];
      if (scenario !== 'empty') rows.push(article('eligible'));
      if (scenario === 'error') queryError = { message: 'lookup unavailable' };
      if (scenario === 'rejected') rejection = new Error('connection interrupted');

      const html = renderToStaticMarkup(await ArticlePage({
        params: Promise.resolve({ id: 'current' }),
      }));

      expect(html).toContain('Title current');
      expect(html).not.toContain('more from ');
      expect(html).not.toContain('href="/article/eligible"');
      expect(from).toHaveBeenCalledTimes(2);
    }
  );
});
