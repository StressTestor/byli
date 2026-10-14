import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Executes the actual staged SQL on an isolated in-memory PostgreSQL engine.
// No Supabase credentials, remote database, or production reads are used.
const db = new PGlite();
const asOf = '2026-10-14T00:00:00.000Z';
const rows = Array.from({ length: 137 }, (_, i) => ({
  id: `00000000-0000-0000-0000-${(i + 1).toString(16).padStart(12, '0')}`,
  publishedAt: i % 23 === 0 ? null : new Date(Date.parse(asOf) - (24 + Math.floor(i / 5)) * 3600000).toISOString(),
  likes: (i * 7) % 11,
  bookmarks: i % 3,
  comments: i % 2,
  featured: i % 9 === 0,
  tech: i % 3 !== 0,
}));

type Row = { id: string; published_at: string | null; cursor_rank: string; score: number };
async function page(sort: string, category: string | null, cursor: Record<string, unknown> | null, limit = 21) {
  // row_to_json preserves SQL timestamps/microseconds as strings, like PostgREST.
  const result = await db.query<{ row: Row }>(
    'SELECT row_to_json(f) AS row FROM public.get_feed_page($1, $2, $3, $4::jsonb, $5) f',
    [category, sort, asOf, cursor === null ? null : JSON.stringify(cursor), limit],
  );
  return result.rows.map(({ row }) => row);
}

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.authors (id uuid PRIMARY KEY, handle text, display_name text, avatar_url text, verified boolean);
    CREATE TABLE public.articles (
      id uuid PRIMARY KEY, title text, excerpt text, x_url text, cover_image_url text,
      read_time_min int, featured boolean, published_at timestamptz, indexed_at timestamptz,
      source text, author_id uuid, status text
    );
    CREATE TABLE public.article_stats (article_id uuid PRIMARY KEY, like_count int, bookmark_count int,
      comment_count int, share_count int, avg_rating numeric);
    CREATE TABLE public.categories (id uuid PRIMARY KEY, slug text);
    CREATE TABLE public.article_categories (article_id uuid, category_id uuid, PRIMARY KEY(article_id, category_id));
    CREATE FUNCTION public.feed_score(timestamptz, int, int, int, boolean) RETURNS numeric
      LANGUAGE sql AS $$ SELECT 0::numeric $$;
    INSERT INTO public.authors VALUES ('00000000-0000-0000-0000-000000000001', 'author', 'Author', NULL, true);
    INSERT INTO public.categories VALUES
      ('00000000-0000-0000-0000-000000000001', 'tech'),
      ('00000000-0000-0000-0000-000000000002', 'science');
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
  `);
  for (const row of rows) {
    await db.query(`INSERT INTO public.articles VALUES
      ($1, 'Article', NULL, 'https://example.test', NULL, 3, $2, $3, '2026-10-01', 'test',
        '00000000-0000-0000-0000-000000000001', 'published')`,
      [row.id, row.featured, row.publishedAt]);
    await db.query('INSERT INTO public.article_stats VALUES ($1, $2, $3, $4, 0, 0)',
      [row.id, row.likes, row.bookmarks, row.comments]);
    if (row.tech) await db.query(`INSERT INTO public.article_categories VALUES ($1, '00000000-0000-0000-0000-000000000001')`, [row.id]);
    await db.query(`INSERT INTO public.article_categories VALUES ($1, '00000000-0000-0000-0000-000000000002')`, [row.id]);
  }
  // Both kinds of rows must stay out of this established feed snapshot.
  await db.exec(`INSERT INTO public.articles (id, title, author_id, status, published_at, indexed_at) VALUES
    ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'New ingestion', '00000000-0000-0000-0000-000000000001', 'published', now(), '2026-10-15'),
    ('ffffffff-ffff-ffff-ffff-fffffffffffe', 'Private draft', '00000000-0000-0000-0000-000000000001', 'pending', now(), '2026-10-01');`);
  await db.exec(readFileSync('supabase/proposed/20261014012000_add_ranked_feed_pagination.sql', 'utf8'));
}, 30000);

afterAll(async () => { await db.close(); });

function expectedOrder(sort: string, category: string | null) {
  const rank = (r: typeof rows[number]) => sort === 'POPULAR' ? r.likes : sort === 'LATEST' ? 0 :
    0.4 * (r.publishedAt === null ? 0 : Math.exp(-0.04 * (Date.parse(asOf) - Date.parse(r.publishedAt)) / 3600000)) +
    0.4 * Math.log(r.likes + r.bookmarks * 2 + r.comments * 1.5 + 1) / Math.log(1001) + (r.featured ? 0.2 : 0);
  return rows.filter((r) => !category || r.tech).sort((a, b) => {
    const ranking = rank(b) - rank(a);
    if (ranking) return ranking;
    const aDate = a.publishedAt === null ? -Infinity : Date.parse(a.publishedAt);
    const bDate = b.publishedAt === null ? -Infinity : Date.parse(b.publishedAt);
    return (aDate === bDate ? 0 : bDate - aDate) || b.id.localeCompare(a.id);
  }).map((r) => r.id);
}

describe('ranked feed SQL pagination', () => {
  for (const sort of ['POPULAR', 'LATEST', 'FOR_YOU']) {
    for (const category of [null, 'tech']) {
      it(`${sort} / ${category ?? 'all'} traverses multiple pages without missing or duplicate tied/null-date rows`, async () => {
        const ids: string[] = [];
        let cursor: Record<string, unknown> | null = null;
        for (let i = 0; i < 30; i++) {
          const result = await page(sort, category, cursor, 14);
          const visible = result.slice(0, 13);
          ids.push(...visible.map((r) => r.id));
          if (result.length <= 13) break;
          const last = visible[visible.length - 1];
          cursor = { rank: last.cursor_rank, published_at: last.published_at, id: last.id };
        }
        expect(ids).toEqual(expectedOrder(sort, category));
        expect(new Set(ids).size).toBe(ids.length);
      });
    }
  }

  it('enforces a 51-row maximum inside the new and legacy database functions', async () => {
    expect(await page('POPULAR', null, null, 999999)).toHaveLength(51);
    expect(await page('POPULAR', null, null, -20)).toHaveLength(1);
    const legacy = await db.query('SELECT * FROM public.get_feed(NULL, $1, NULL, 999999)', ['LATEST']);
    expect(legacy.rows).toHaveLength(51);
  });

  it('uses deterministic timestamp and UUID tiebreakers on legacy first pages', async () => {
    const result = await db.query<{ id: string }>('SELECT id FROM public.get_feed(NULL, $1, NULL, 20)', ['LATEST']);
    // Legacy intentionally retains its old scope, including newer ingestion.
    expect(result.rows.slice(1).map((r) => r.id)).toEqual(expectedOrder('LATEST', null).slice(0, 19));
  });

  it('rejects malformed cursor keys and unsupported sort values', async () => {
    await expect(page('POPULAR', null, { rank: 'NaN', published_at: null, id: rows[0].id })).rejects.toThrow('Invalid feed cursor');
    await expect(page('other', null, null)).rejects.toThrow('Invalid feed sort');
  });

  it('denies new direct RPC execution to anon/authenticated and permits the application role', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      try {
        await expect(page('LATEST', null, null)).rejects.toThrow('permission denied');
      } finally { await db.exec('RESET ROLE'); }
    }
    await db.exec('SET ROLE service_role');
    try { expect(await page('LATEST', null, null)).toHaveLength(21); }
    finally { await db.exec('RESET ROLE'); }
  });
});
