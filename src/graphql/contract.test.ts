import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getIntrospectionQuery, parse, Kind, type OperationDefinitionNode } from 'graphql';
import type { Tables, Database } from '@/types/supabase';

// Contract test for /api/graphql: every Query and Mutation field in the schema
// runs through a real ApolloServer (real SDL, real resolvers) against a mocked
// Supabase that returns rows shaped like src/types/supabase.ts. A response with
// no errors means every non-null field resolved to a non-null value.

type FeedRow = Database['public']['Functions']['get_feed']['Returns'][number];
type SearchRow = Database['public']['Functions']['search_articles']['Returns'][number];

const db = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  rpc: {} as Record<string, any[]>,
  calls: [] as { table: string; method: string; args: any[] }[],
  authCalls: 0,
  authUserId: '00000000-0000-4000-8000-000000000001' as string | null,
  // Parameter names each RPC accepts. `satisfies` ties them to the generated
  // Args types, so a renamed parameter breaks the type-check, and the mock
  // rejects any name not listed here.
  rpcArgs: {
    get_feed: ['p_category_slug', 'p_cursor', 'p_limit', 'p_sort'],
    search_articles: ['p_limit', 'p_offset', 'p_query'],
  } satisfies {
    [K in 'get_feed' | 'search_articles']: (keyof Database['public']['Functions'][K]['Args'])[];
  } as Record<string, string[]>,
}));

// Query-builder stand-in. Every chain method returns the builder; awaiting it,
// .single() or .maybeSingle() resolves the table's fixture rows. eq() filters
// on plain columns so lookups by id behave like the real thing, and throws on
// a column the fixture rows (full generated Row objects) don't have.
vi.mock('@/lib/supabase-admin', () => {
  const CHAIN = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'gte', 'lt', 'order', 'limit', 'range'];
  function from(table: string) {
    if (!(table in db.tables)) throw new Error(`mock: unknown table ${table}`);
    const filters: [string, unknown][] = [];
    let head = false;
    const b: any = {};
    for (const m of CHAIN) {
      b[m] = (...args: any[]) => {
        db.calls.push({ table, method: m, args });
        if (m === 'eq') {
          if (!db.tables[table].every((r) => args[0] in r)) throw new Error(`mock: unknown column ${table}.${args[0]}`);
          filters.push([args[0], args[1]]);
        }
        if (m === 'select' && args[1]?.head) head = true;
        return b;
      };
    }
    const rows = () =>
      db.tables[table].filter((r) => filters.every(([k, v]) => r[k] === v));
    const result = () => {
      const data = rows();
      return { data: head ? null : data, count: data.length, error: null };
    };
    b.then = (ok: any, fail: any) => Promise.resolve(result()).then(ok, fail);
    b.single = () => {
      const [row] = rows();
      return Promise.resolve(row ? { data: row, error: null } : { data: null, error: { message: 'no rows' } });
    };
    b.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    return b;
  }
  return {
    supabaseAdmin: {
      from,
      rpc: (fn: string, args: Record<string, unknown>) => {
        db.calls.push({ table: `rpc:${fn}`, method: 'rpc', args: [args] });
        const allowed = db.rpcArgs[fn];
        if (!allowed) throw new Error(`mock: unknown function ${fn}`);
        const unknown = Object.keys(args).filter((k) => !allowed.includes(k));
        if (unknown.length) throw new Error(`mock: ${fn} has no parameter ${unknown.join(', ')}`);
        return Promise.resolve({ data: db.rpc[fn] ?? [], error: null });
      },
    },
  };
});

const USER_ID = '00000000-0000-4000-8000-000000000001';
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServer: async () => ({
    auth: {
      getUser: async () => {
        db.authCalls++;
        return { data: { user: db.authUserId ? { id: db.authUserId, email: 'u@example.com' } : null }, error: null };
      },
    },
  }),
}));

import { createGraphqlServer } from './server';
import { MAX_QUERY_DEPTH } from './depth-limit';
import {
  API_TS_OPERATIONS, HOME_FEED_OPERATIONS, FE_FEED, FE_ARTICLE, FE_LIKE, FE_UNLIKE, FE_BOOKMARK,
  FE_REMOVE_BOOKMARK, FE_RATE, FE_SUBMIT, FE_HOME_FEED,
} from './test-fixtures/frontend-operations';

const typeDefs = readFileSync(join(process.cwd(), 'src/graphql/schema.graphql'), 'utf-8');
const server = createGraphqlServer(typeDefs);

// ─── Fixtures (snake_case, matching the generated Row types) ─────────────

const AUTHOR_ID = '00000000-0000-4000-8000-0000000000a1';
const CAT_ID = '00000000-0000-4000-8000-0000000000c1';
const ART1 = '00000000-0000-4000-8000-0000000000b1';
const ART2 = '00000000-0000-4000-8000-0000000000b2';
const SUB_ID = '00000000-0000-4000-8000-0000000000d1';
const KEY_ID = '00000000-0000-4000-8000-0000000000e1';

const authorRow: Tables<'authors'> = {
  id: AUTHOR_ID, handle: 'karpathy', display_name: 'Andrej', avatar_url: 'https://pbs.twimg.com/a.jpg',
  bio: 'writes things', verified: true, claimed: null, claimed_by: null, follower_count: 1200,
  article_count: 2, x_user_id: null, created_at: '2026-01-01T00:00:00Z', updated_at: null,
};
const categoryRow: Tables<'categories'> = {
  id: CAT_ID, slug: 'ai', label: 'AI', icon: 'cpu', sort_order: 1, created_at: '2026-01-01T00:00:00Z',
};
function statsRow(article_id: string): Tables<'article_stats'> {
  return {
    article_id, like_count: 10, bookmark_count: 3, comment_count: 1, share_count: 2,
    rating_count: 4, rating_sum: 18, avg_rating: 4.5, updated_at: null,
  };
}
function articleRow(id: string, title: string, published_at: string): Tables<'articles'> {
  return {
    id, author_id: AUTHOR_ID, title, excerpt: 'excerpt', body_preview: 'body', x_url: `https://x.com/i/article/${id}`,
    x_article_id: `x-${id}`, cover_image_url: null, read_time_min: 5, featured: null, status: 'published',
    published_at, indexed_at: '2026-02-01T00:00:00Z', updated_at: null, source: 'seed',
    editorial_reason: null, quality_score: null,
  };
}
// The resolvers' select() embeds author, categories and stats.
function articleWithRelations(id: string, title: string, published_at: string) {
  return {
    ...articleRow(id, title, published_at),
    author: authorRow,
    categories: [{ category: categoryRow }],
    stats: statsRow(id),
  };
}
const profileRow: Tables<'profiles'> = {
  id: USER_ID, username: 'joe', avatar_url: 'https://pbs.twimg.com/u.jpg', x_handle: 'joe_x',
  x_user_id: '42', role: 'user', created_at: '2026-01-01T00:00:00Z', updated_at: null,
};
const submissionRow: Tables<'submissions'> & { category: Tables<'categories'> } = {
  id: SUB_ID, url: 'https://x.com/i/article/123', category_id: CAT_ID, notes: 'good one', status: 'pending',
  submitted_by: USER_ID, article_id: null, created_at: '2026-03-01T00:00:00Z', reviewed_at: null,
  reviewed_by: null, category: categoryRow,
};
const apiKeyRow: Tables<'api_keys'> = {
  id: KEY_ID, user_id: USER_ID, key_hash: 'hash', label: 'cli', tier: null, rate_limit: null,
  revoked: false, last_used: null, created_at: '2026-03-02T00:00:00Z',
};
function feedRow(id: string, title: string, published_at: string): FeedRow {
  return {
    id, title, published_at, excerpt: 'excerpt', x_url: `https://x.com/i/article/${id}`, cover_image_url: 'https://pbs.twimg.com/c.jpg',
    read_time_min: 4, featured: true, author_id: AUTHOR_ID, author_handle: 'karpathy', author_display_name: 'Andrej',
    author_avatar_url: 'https://pbs.twimg.com/a.jpg', author_verified: true, like_count: 10, bookmark_count: 3,
    comment_count: 1, share_count: 2, avg_rating: 4.5, score: 0.9, source: 'seed',
  };
}
function searchRow(id: string, title: string, published_at: string): SearchRow {
  return {
    id, title, published_at, excerpt: 'excerpt', x_url: `https://x.com/i/article/${id}`, cover_image_url: 'https://pbs.twimg.com/c.jpg',
    read_time_min: 4, author_handle: 'karpathy', author_display_name: 'Andrej', author_verified: true,
    like_count: 10, relevance: 0.7,
  };
}

beforeEach(() => {
  db.calls = [];
  db.authCalls = 0;
  db.authUserId = USER_ID;
  db.tables = {
    articles: [
      articleWithRelations(ART1, 'First', '2026-02-02T00:00:00Z'),
      articleWithRelations(ART2, 'Second', '2026-02-01T00:00:00Z'),
    ],
    authors: [authorRow],
    categories: [categoryRow],
    article_categories: [
      { article_id: ART1, category_id: CAT_ID },
      { article_id: ART2, category_id: CAT_ID },
    ],
    profiles: [profileRow],
    submissions: [submissionRow],
    api_keys: [apiKeyRow],
    likes: [{ user_id: USER_ID, article_id: ART1, created_at: '2026-03-01T00:00:00Z' }],
    bookmarks: [{ user_id: USER_ID, article_id: ART1, created_at: '2026-03-01T00:00:00Z' }],
    ratings: [{ user_id: USER_ID, article_id: ART1, score: 4, created_at: '2026-03-01T00:00:00Z', updated_at: null }],
  };
  db.rpc = {
    get_feed: [feedRow(ART1, 'First', '2026-02-02T00:00:00Z'), feedRow(ART2, 'Second', '2026-02-01T00:00:00Z')],
    search_articles: [searchRow(ART1, 'First', '2026-02-02T00:00:00Z')],
  };
});

async function run(query: string, variables?: Record<string, unknown>) {
  const res = await server.executeOperation(
    { query, variables },
    { contextValue: { authToken: null, apiKey: null } },
  );
  if (res.body.kind !== 'single') throw new Error('expected a single result');
  return res.body.singleResult;
}

async function ok(query: string, variables?: Record<string, unknown>): Promise<any> {
  const result = await run(query, variables);
  expect(result.errors).toBeUndefined();
  expect(result.data).toBeTruthy();
  return result.data;
}

// ─── Full selections ────────────────────────────────────────────────────

const AUTHOR_FIELDS = 'id handle displayName avatarUrl bio verified claimed followerCount articleCount';
const CATEGORY_FIELDS = 'id slug label icon articleCount';
const STATS_FIELDS = 'likeCount bookmarkCount commentCount shareCount ratingCount avgRating';
const ARTICLE_SCALARS = `id xArticleId xUrl title excerpt bodyPreview coverImageUrl readTimeMin featured
  publishedAt indexedAt viewerHasLiked viewerHasBookmarked viewerRating`;
const ARTICLE_FIELDS = `${ARTICLE_SCALARS}
  author { ${AUTHOR_FIELDS} }
  categories { ${CATEGORY_FIELDS} }
  stats { ${STATS_FIELDS} }`;
const PAGE_INFO = 'pageInfo { hasNextPage hasPreviousPage startCursor endCursor }';
const CONNECTION = `edges { node { ${ARTICLE_FIELDS} } cursor score } ${PAGE_INFO} totalCount`;
const USER_FIELDS = 'id username avatarUrl xHandle';
const SUBMISSION_FIELDS = `id url notes status createdAt reviewedAt category { ${CATEGORY_FIELDS} }`;
const API_KEY_FIELDS = 'id label tier rateLimit lastUsed createdAt key';

// search_articles has no author id column, so search nodes cannot resolve
// Author.id; every other Article field is covered.
const SEARCH_CONNECTION = `edges { node { ${ARTICLE_SCALARS}
  author { handle displayName avatarUrl bio verified claimed followerCount articleCount }
  categories { ${CATEGORY_FIELDS} }
  stats { ${STATS_FIELDS} } } cursor score } ${PAGE_INFO} totalCount`;

const OPS = {
  articles: `query { articles(first: 5, sort: LATEST) { ${CONNECTION} } }`,
  articlesSearch: `query { articles(first: 5, search: "ai") { ${SEARCH_CONNECTION} } }`,
  article: `query($id: UUID) { article(id: $id) { ${ARTICLE_FIELDS} } }`,
  articleByX: `query { article(xArticleId: "x-${ART1}") { id } }`,
  author: `query { author(handle: "karpathy") { ${AUTHOR_FIELDS} articles(first: 5) { ${CONNECTION.replace(
    `author { ${AUTHOR_FIELDS} }`, 'author { id handle }')} } } }`,
  trending: `query { trending(timeframe: MONTH, first: 5) { ${CONNECTION} } }`,
  categories: `query { categories { ${CATEGORY_FIELDS} } }`,
  me: `query { me { ${USER_FIELDS} } }`,
  mySubmissions: `query { mySubmissions(status: PENDING) { ${SUBMISSION_FIELDS} } }`,
  likeArticle: `mutation($a: UUID!) { likeArticle(articleId: $a) { ${ARTICLE_FIELDS} } }`,
  unlikeArticle: `mutation($a: UUID!) { unlikeArticle(articleId: $a) { ${ARTICLE_FIELDS} } }`,
  bookmarkArticle: `mutation($a: UUID!) { bookmarkArticle(articleId: $a) { ${ARTICLE_FIELDS} } }`,
  removeBookmark: `mutation($a: UUID!) { removeBookmark(articleId: $a) { ${ARTICLE_FIELDS} } }`,
  rateArticle: `mutation($a: UUID!) { rateArticle(articleId: $a, score: 4) { ${ARTICLE_FIELDS} } }`,
  removeRating: `mutation($a: UUID!) { removeRating(articleId: $a) { ${ARTICLE_FIELDS} } }`,
  submitArticle: `mutation { submitArticle(input: { url: "https://x.com/i/article/123", categoryId: "${CAT_ID}", notes: "n" }) { ${SUBMISSION_FIELDS} } }`,
  updateProfile: `mutation { updateProfile(input: { username: "joe", avatarUrl: "https://pbs.twimg.com/u.jpg" }) { ${USER_FIELDS} } }`,
  createApiKey: `mutation { createApiKey(label: "cli") { ${API_KEY_FIELDS} } }`,
  revokeApiKey: `mutation { revokeApiKey(id: "${KEY_ID}") }`,
};

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

// ─── Tests ──────────────────────────────────────────────────────────────

describe('schema coverage', () => {
  it('every Query and Mutation field is exercised by an operation here', () => {
    const schemaDoc = parse(typeDefs);
    const declared = new Set<string>();
    for (const def of schemaDoc.definitions) {
      if (def.kind === Kind.OBJECT_TYPE_DEFINITION && (def.name.value === 'Query' || def.name.value === 'Mutation')) {
        for (const f of def.fields ?? []) declared.add(`${def.name.value}.${f.name.value}`);
      }
    }
    const exercised = new Set<string>();
    for (const op of Object.values(OPS)) {
      const def = parse(op).definitions[0] as OperationDefinitionNode;
      const root = def.operation === 'mutation' ? 'Mutation' : 'Query';
      for (const sel of def.selectionSet.selections) {
        if (sel.kind === Kind.FIELD) exercised.add(`${root}.${sel.name.value}`);
      }
    }
    expect([...exercised].sort()).toEqual([...declared].sort());
  });

  it('does not declare operations that have no resolver', () => {
    expect(typeDefs).not.toMatch(/\bsearch\s*\(\s*query:/);
    expect(typeDefs).not.toMatch(/\bclaimAuthor\b/);
  });
});

describe('every operation resolves without errors', () => {
  for (const [name, query] of Object.entries(OPS)) {
    it(name, async () => {
      await ok(query, { id: ART1, a: ART1 });
    });
  }
});

describe('resolved values map from snake_case rows', () => {
  it('articles (get_feed) maps flat feed rows', async () => {
    const data = await ok(OPS.articles);
    const node = data.articles.edges[0].node;
    expect(node).toMatchObject({
      id: ART1, xUrl: `https://x.com/i/article/${ART1}`, coverImageUrl: 'https://pbs.twimg.com/c.jpg',
      readTimeMin: 4, featured: true, publishedAt: '2026-02-02T00:00:00Z',
      author: { id: AUTHOR_ID, handle: 'karpathy', displayName: 'Andrej', avatarUrl: 'https://pbs.twimg.com/a.jpg', verified: true },
      stats: { likeCount: 10, bookmarkCount: 3, commentCount: 1, shareCount: 2, avgRating: 4.5 },
    });
    expect(data.articles.edges[0].score).toBe(0.9);
  });

  it('article maps a full row with relations', async () => {
    const data = await ok(OPS.article, { id: ART1 });
    expect(data.article).toMatchObject({
      id: ART1, xArticleId: `x-${ART1}`, bodyPreview: 'body', featured: false, indexedAt: '2026-02-01T00:00:00Z',
      viewerHasLiked: true, viewerHasBookmarked: true, viewerRating: 4,
      author: { id: AUTHOR_ID, displayName: 'Andrej', claimed: false, followerCount: 1200, articleCount: 2, bio: 'writes things' },
      categories: [{ id: CAT_ID, slug: 'ai', label: 'AI', icon: 'cpu', articleCount: 2 }],
      stats: { likeCount: 10, ratingCount: 4, avgRating: 4.5 },
    });
  });

  it('categories carry articleCount and no raw columns', async () => {
    const data = await ok(OPS.categories);
    expect(data.categories).toEqual([{ id: CAT_ID, slug: 'ai', label: 'AI', icon: 'cpu', articleCount: 2 }]);
  });

  it('me maps profiles columns to User', async () => {
    const data = await ok(OPS.me);
    expect(data.me).toEqual({ id: USER_ID, username: 'joe', avatarUrl: 'https://pbs.twimg.com/u.jpg', xHandle: 'joe_x' });
  });

  it('updateProfile maps profiles columns to User', async () => {
    const data = await ok(OPS.updateProfile);
    expect(data.updateProfile).toEqual({ id: USER_ID, username: 'joe', avatarUrl: 'https://pbs.twimg.com/u.jpg', xHandle: 'joe_x' });
  });

  it('submissions map status to the enum and created_at to createdAt', async () => {
    const expected = {
      id: SUB_ID, url: 'https://x.com/i/article/123', notes: 'good one', status: 'PENDING',
      createdAt: '2026-03-01T00:00:00Z', reviewedAt: null,
      category: { id: CAT_ID, slug: 'ai', label: 'AI', icon: 'cpu', articleCount: 2 },
    };
    expect((await ok(OPS.mySubmissions)).mySubmissions).toEqual([expected]);
    expect((await ok(OPS.submitArticle)).submitArticle).toEqual(expected);
  });

  it('createApiKey maps api_keys columns and returns the raw key once', async () => {
    const data = await ok(OPS.createApiKey);
    expect(data.createApiKey).toMatchObject({
      id: KEY_ID, label: 'cli', tier: 'developer', rateLimit: 300, lastUsed: null, createdAt: '2026-03-02T00:00:00Z',
    });
    expect(data.createApiKey.key).toMatch(/^bl_[0-9a-f]{32}$/);
  });
});

describe('trending pagination', () => {
  const TRENDING = `query($after: String) { trending(first: 1, after: $after) { edges { node { id } cursor } ${PAGE_INFO} totalCount } }`;

  it('fetches one extra row and reports hasNextPage from it', async () => {
    const data = await ok(TRENDING);
    const range = db.calls.find((c) => c.table === 'articles' && c.method === 'range');
    expect(range?.args).toEqual([0, 1]);
    expect(data.trending.edges.map((e: any) => e.node.id)).toEqual([ART1]);
    expect(data.trending.pageInfo).toMatchObject({ hasNextPage: true, hasPreviousPage: false });
    expect(data.trending.totalCount).toBe(1);
  });

  it('the endCursor resumes at the next offset', async () => {
    const first = await ok(TRENDING);
    db.calls = [];
    db.tables.articles = [db.tables.articles[1]];
    const second = await ok(TRENDING, { after: first.trending.pageInfo.endCursor });
    const range = db.calls.find((c) => c.table === 'articles' && c.method === 'range');
    expect(range?.args).toEqual([1, 2]);
    expect(second.trending.edges.map((e: any) => e.node.id)).toEqual([ART2]);
    expect(second.trending.pageInfo).toMatchObject({ hasNextPage: false, hasPreviousPage: true });
  });

  it('a hidden title does not end pagination early', async () => {
    db.tables.articles = [
      articleWithRelations(ART1, 'A retarded take', '2026-02-02T00:00:00Z'),
      articleWithRelations(ART2, 'Second', '2026-02-01T00:00:00Z'),
    ];
    const data = await ok(TRENDING);
    expect(data.trending.edges).toEqual([]);
    expect(data.trending.pageInfo.hasNextPage).toBe(true);
    expect(data.trending.pageInfo.endCursor).not.toBeNull();
  });

  it('edge cursors keep their position when an earlier row is hidden', async () => {
    db.tables.articles = [
      articleWithRelations(ART1, 'A retarded take', '2026-02-02T00:00:00Z'),
      articleWithRelations(ART2, 'Second', '2026-02-01T00:00:00Z'),
    ];
    const data = await ok(`query { trending(first: 2) { edges { node { id } cursor } } }`);
    expect(data.trending.edges).toEqual([
      { node: { id: ART2 }, cursor: Buffer.from('offset:2').toString('base64') },
    ]);
  });
});

describe('frontend operations', () => {
  it('are still the strings in src/hooks/api.ts and home-feed.tsx', () => {
    const api = squash(readFileSync(join(process.cwd(), 'src/hooks/api.ts'), 'utf-8'));
    const home = squash(readFileSync(join(process.cwd(), 'src/components/feed/home-feed.tsx'), 'utf-8'));
    for (const op of API_TS_OPERATIONS) expect(api).toContain(squash(op));
    for (const op of HOME_FEED_OPERATIONS) expect(home).toContain(squash(op));
  });

  it('useFeed Feed query (browse)', async () => {
    const data = await ok(FE_FEED, { first: 20, after: null, category: null, sort: 'POPULAR', search: null });
    expect(data.articles.edges).toHaveLength(2);
    expect(data.articles.edges[0].node.author.avatarUrl).toBe('https://pbs.twimg.com/a.jpg');
  });

  it('useFeed Feed query (search)', async () => {
    const data = await ok(FE_FEED, { first: 20, after: null, category: null, sort: 'POPULAR', search: 'ai' });
    expect(db.calls.some((c) => c.table === 'rpc:search_articles')).toBe(true);
    expect(data.articles.edges[0].node).toMatchObject({ id: ART1, author: { handle: 'karpathy' } });
  });

  it('useArticle Article query', async () => {
    const data = await ok(FE_ARTICLE, { id: ART1 });
    expect(data.article.id).toBe(ART1);
  });

  it('engagement mutations', async () => {
    for (const op of [FE_LIKE, FE_UNLIKE, FE_BOOKMARK, FE_REMOVE_BOOKMARK]) {
      await ok(op, { id: ART1 });
    }
    const rated = await ok(FE_RATE, { id: ART1, score: 4 });
    expect(rated.rateArticle).toMatchObject({ id: ART1, viewerRating: 4, stats: { ratingCount: 4 } });
  });

  it('useSubmitArticle Submit mutation', async () => {
    const data = await ok(FE_SUBMIT, { input: { url: 'https://x.com/i/article/123', categoryId: CAT_ID, notes: 'n' } });
    expect(data.submitArticle).toEqual({ id: SUB_ID, url: 'https://x.com/i/article/123', status: 'PENDING', createdAt: '2026-03-01T00:00:00Z' });
  });

  it('home-feed FEED_QUERY', async () => {
    const data = await ok(FE_HOME_FEED, { first: 20, after: null, category: null, sort: 'LATEST' });
    expect(data.articles.pageInfo.hasNextPage).toBe(false);
  });
});

describe('depth limit on the server', () => {
  it('rejects a query nested past MAX_QUERY_DEPTH before any resolver runs', async () => {
    // author > articles > edges > node > author > articles > edges > node > id = 9
    const deep = `query { author(handle: "karpathy") { articles { edges { node { author { articles { edges { node { id } } } } } } } } }`;
    const result = await run(deep);
    expect(result.data).toBeUndefined();
    expect(result.errors?.[0]).toMatchObject({
      message: `Query depth 9 exceeds the maximum of ${MAX_QUERY_DEPTH}.`,
      extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
    });
    expect(db.calls).toEqual([]);
  });

  it('lets the introspection query through outside production', async () => {
    const result = await run(getIntrospectionQuery());
    expect(result.errors).toBeUndefined();
  });
});


describe('submission and profile input boundaries', () => {
  it.each(['javascript:alert(1)//x.com', 'https://x.com.evil.test/a', 'https://x.com@evil.test/a', 'http://x.com/a'])('rejects unsafe submission before insert: %s', async url => {
    const result = await run(FE_SUBMIT, { input: { url } });
    expect(result.errors).toBeDefined();
    expect(db.calls.some(c => c.method === 'insert')).toBe(false);
  });
  it('rejects oversized notes before insert', async () => {
    const result = await run(FE_SUBMIT, { input: { url: 'https://x.com/i/article/123', notes: 'x'.repeat(2001) } });
    expect(result.errors).toBeDefined();
    expect(db.calls.some(c => c.method === 'insert')).toBe(false);
  });
  it.each(['', 'a', 'a'.repeat(40), 'user name', '<script>', 'name@x'])('rejects invalid username before update: %s', async username => {
    const result = await run('mutation($input: UpdateProfileInput!) { updateProfile(input: $input) { id } }', { input: { username } });
    expect(result.errors).toBeDefined();
    expect(db.calls.some(c => c.method === 'update')).toBe(false);
  });
  it.each(['ab', 'a'.repeat(39), 'User_name-9'])('accepts existing username invariant: %s', async username => {
    await ok('mutation($input: UpdateProfileInput!) { updateProfile(input: $input) { id } }', { input: { username } });
    expect(db.calls.find(c => c.method === 'update')?.args[0]).toEqual({ username });
  });
});

describe('resource bounds before database execution', () => {
  it('reports invalid variables as user input errors before database/auth work', async () => {
    const result = await run('query($n: Int!) { articles(first: $n) { totalCount } }', { n: '50' });
    expect(result.errors?.[0].extensions?.code).toBe('BAD_USER_INPUT');
    expect(db.calls).toEqual([]);
    expect(db.authCalls).toBe(0);
  });

  it('rejects shallow root alias amplification without any database/auth calls', async () => {
    const roots = Array.from({ length: 9 }, (_, i) => `a${i}: categories { articleCount }`).join(' ');
    const result = await run(`{ ${roots} }`);
    expect(result.errors?.[0].message).toContain('root fields');
    expect(result.data).toBeUndefined();
    expect(db.calls).toEqual([]);
    expect(db.authCalls).toBe(0);
  });

  it('rechecks variables even when Apollo has cached the validated document', async () => {
    const query = `query($first: Int!) {
      articles(first: $first) { edges { node { author { articles(first: $first) { totalCount } } } } }
    }`;
    await ok(query, { first: 1 });
    db.calls = [];
    const result = await run(query, { first: 50 });
    expect(result.errors?.[0].message).toContain('resource budget');
    expect(result.data).toBeUndefined();
    expect(db.calls).toEqual([]);
  });

  it('rejects expanded fragments and multiple mutation roots before work', async () => {
    const fragments = Array.from({ length: 10 }, (_, i) => `fragment F${i} on Article { ...F${i + 1} ...F${i + 1} }`).join('\n');
    const result = await run(`{ article(id: "${ART1}") { ...F0 } } ${fragments} fragment F10 on Article { id }`);
    expect(result.errors?.some(error => error.message.includes('expanded fields'))).toBe(true);
    const mutation = await run(`mutation { a: likeArticle(articleId: "${ART1}") { id } b: unlikeArticle(articleId: "${ART1}") { id } }`);
    expect(mutation.errors?.[0].message).toContain('root fields');
    expect(db.calls).toEqual([]);
    expect(db.authCalls).toBe(0);
  });

  it('enforces the parser token limit before any resolvers run', async () => {
    const result = await run(`{ article(id: "${ART1}") { ${'id '.repeat(3_000)} } }`);
    expect(result.errors?.[0].message).toContain('3000 tokens');
    expect(db.calls).toEqual([]);
  });
});

describe('bounded request-local resolver reads', () => {
  const viewerQuery = `{
    articles(first: 2) { edges { node {
      id viewerHasLiked again: viewerHasLiked viewerHasBookmarked viewerRating
    } } }
  }`;

  it('batches viewer state once per table and authenticates once across a page', async () => {
    const result = await ok(viewerQuery);
    expect(result.articles.edges[0].node).toMatchObject({ viewerHasLiked: true, again: true, viewerRating: 4 });
    expect(result.articles.edges[1].node).toMatchObject({ viewerHasLiked: false, viewerHasBookmarked: false, viewerRating: null });
    expect(db.authCalls).toBe(1);
    for (const table of ['likes', 'bookmarks', 'ratings']) {
      expect(db.calls.filter(call => call.table === table && call.method === 'select')).toHaveLength(1);
      expect(db.calls.find(call => call.table === table && call.method === 'in')?.args).toEqual(['article_id', [ART1, ART2]]);
    }
  });

  it('never reuses authenticated viewer state on a later anonymous request', async () => {
    await ok(viewerQuery);
    db.authUserId = null;
    db.calls = [];
    const result = await ok(viewerQuery);
    expect(db.authCalls).toBe(2);
    expect(result.articles.edges[0].node).toMatchObject({ viewerHasLiked: false, again: false, viewerHasBookmarked: false, viewerRating: null });
    expect(db.calls.some(call => ['likes', 'bookmarks', 'ratings'].includes(call.table))).toBe(false);
  });

  it('isolates different users and shares root mutation authentication', async () => {
    await ok(viewerQuery);
    db.authUserId = '00000000-0000-4000-8000-000000000099';
    const result = await ok(viewerQuery);
    expect(result.articles.edges[0].node.viewerHasLiked).toBe(false);
    expect(db.authCalls).toBe(2);
    db.authUserId = USER_ID;
    db.authCalls = 0;
    await ok(FE_LIKE, { id: ART1 });
    expect(db.authCalls).toBe(1);
  });

  it('limits categories and does not count articles unless requested', async () => {
    await ok('{ categories { id slug } }');
    expect(db.calls.find(call => call.table === 'categories' && call.method === 'limit')?.args).toEqual([50]);
    expect(db.calls.some(call => call.table === 'article_categories')).toBe(false);
  });

  it('counts exactly using one HEAD query per distinct category, beyond the row-transfer cap', async () => {
    db.tables.article_categories = Array.from({ length: 1_234 }, (_, i) => ({ article_id: `a${i}`, category_id: CAT_ID }));
    const result = await ok(`{
      categories { articleCount again: articleCount }
      article(id: "${ART1}") { categories { articleCount } }
    }`);
    expect(result.categories[0]).toEqual({ articleCount: 1_234, again: 1_234 });
    expect(result.article.categories[0].articleCount).toBe(1_234);
    const counts = db.calls.filter(call => call.table === 'article_categories' && call.method === 'select');
    expect(counts).toHaveLength(1);
    expect(counts[0].args).toEqual(['category_id', { count: 'exact', head: true }]);
    await ok('{ categories { articleCount } }');
    expect(db.calls.filter(call => call.table === 'article_categories' && call.method === 'select')).toHaveLength(2);
  });

  it('bounds submissions and embedded category result lists', async () => {
    await ok('{ mySubmissions { id } }');
    expect(db.calls.find(call => call.table === 'submissions' && call.method === 'limit')?.args).toEqual([50]);
    db.tables.articles[0].categories = Array.from({ length: 60 }, () => ({ category: categoryRow }));
    const result = await ok(`{ article(id: "${ART1}") { categories { id } } }`);
    expect(result.article.categories).toHaveLength(50);
  });
});
