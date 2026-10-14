import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The module reads the key at import time; set it before the import below.
vi.hoisted(() => { process.env.TWITTERAPI_IO_KEY = 'sk-test-secret-key'; });

type Query = {
  table: string;
  op: 'select' | 'insert' | 'upsert' | 'update';
  filters: unknown[][];
  payload?: any;
  options?: any;
};
type Reply = { data: any; error: any };

const db = vi.hoisted(() => ({
  calls: [] as Query[],
  respond: (_q: Query): Reply => ({ data: null, error: null }),
}));

vi.mock('@/lib/supabase-admin', () => {
  const from = (table: string) => {
    const q: Query = { table, op: 'select', filters: [] };
    const exec = () => {
      db.calls.push(q);
      return Promise.resolve(db.respond(q));
    };
    const b: any = {
      select: () => b,
      insert: (p: any) => { q.op = 'insert'; q.payload = p; return b; },
      upsert: (p: any, o: any) => { q.op = 'upsert'; q.payload = p; q.options = o; return b; },
      update: (p: any) => { q.op = 'update'; q.payload = p; return b; },
      eq: (c: string, v: unknown) => { q.filters.push(['eq', c, v]); return b; },
      or: (f: string) => { q.filters.push(['or', f]); return b; },
      order: (c: string, o: unknown) => { q.filters.push(['order', c, o]); return b; },
      maybeSingle: exec,
      single: exec,
      then: (res: any, rej: any) => exec().then(res, rej),
    };
    return b;
  };
  return { supabaseAdmin: { from } };
});

import { ingestArticles, ingestSingleArticle, runIngestion, TwitterApiError } from './ingest';

const author = { id: 'u1', userName: 'writer', name: 'Writer', profilePicture: '', isBlueVerified: true, followers: 50_000 };

function articleTweet(id: string, url?: string) {
  return {
    id, url: url ?? `https://x.com/writer/status/${id}`, text: 't', type: 'tweet', createdAt: '2026-10-01T00:00:00Z',
    author, likeCount: 10, retweetCount: 1, replyCount: 1, bookmarkCount: 1, quoteCount: 0, viewCount: 0,
    article: { title: 'A fine article', preview_text: 'p', contents: [{ text: 'body' }] },
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// Per-endpoint fetch handlers; anything unrouted fails the test loudly.
let routes: {
  timeline: (user: string) => Response | Promise<Response>;
  search: () => Response | Promise<Response>;
  article: (id: string) => Response | Promise<Response>;
};
let fetchMock: ReturnType<typeof vi.fn>;

let seeds: Reply;
let defaultRespond: (q: Query) => Reply;

beforeEach(() => {
  db.calls = [];
  seeds = { data: [{ handle: 'alice', high_yield: false }, { handle: 'bob', high_yield: false }], error: null };
  defaultRespond = (q) => {
    if (q.table === 'seed_accounts') return seeds;
    if (q.table === 'categories') return { data: [], error: null };
    if (q.table === 'ingest_runs' && q.op === 'insert') return { data: { id: 'run-1' }, error: null };
    if (q.table === 'authors') return { data: { id: 'author-1' }, error: null };
    if (q.table === 'articles' && q.op === 'insert') return { data: { id: 'art-1' }, error: null };
    return { data: null, error: null };
  };
  db.respond = (q) => defaultRespond(q);

  routes = {
    timeline: () => json({ status: 'success', data: { tweets: [] } }),
    search: () => json({ status: 'success', tweets: [] }),
    article: () => json({ status: 'error' }),
  };
  fetchMock = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/user/last_tweets')) return routes.timeline(url.searchParams.get('userName')!);
    if (url.pathname.endsWith('/tweet/advanced_search')) return routes.search();
    if (url.pathname.endsWith('/article')) return routes.article(url.searchParams.get('tweet_id')!);
    throw new Error(`unrouted fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const fast = { delayMs: 0 };

function loggedText(): string {
  const spies = [console.error, console.warn, console.log] as unknown as ReturnType<typeof vi.fn>[];
  return spies.flatMap(s => s.mock.calls.flat()).map(a => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join('\n');
}

function timelineCalls(): string[] {
  return fetchMock.mock.calls
    .map(([u]) => new URL(String(u)))
    .filter(u => u.pathname.endsWith('/user/last_tweets'))
    .map(u => u.searchParams.get('userName')!);
}

describe('upstream errors from twitterapi.io', () => {
  it.each([401, 402, 403, 429])('aborts the run when the timeline endpoint answers %i', async (status) => {
    routes.timeline = () => json({ error: 'nope' }, status);

    const err = await ingestArticles(fast).catch(e => e);
    expect(err).toBeInstanceOf(TwitterApiError);
    expect(err.status).toBe(status);
    expect(err.fatal).toBe(true);
    expect(err.message).toContain('/user/last_tweets');
    // The global search phase never runs once the run is aborted.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('advanced_search'))).toBe(false);
  });

  it('counts a 5xx on one account as an error and keeps going', async () => {
    routes.timeline = (user) => user === 'alice'
      ? json({ error: 'upstream' }, 503)
      : json({ status: 'success', data: { tweets: [articleTweet('42')] } });

    const result = await ingestArticles(fast);
    expect(result.errors).toBe(1);
    expect(result.new_articles).toBe(1);
    expect(result.accounts_checked).toBe(1);
    expect(loggedText()).toContain('503');
  });

  it('treats a network failure as a per-account error', async () => {
    routes.timeline = (user) => {
      if (user === 'alice') throw new TypeError('fetch failed');
      return json({ status: 'success', data: { tweets: [] } });
    };
    const result = await ingestArticles(fast);
    expect(result.errors).toBe(1);
    expect(result.skipped_unavailable).toBe(1);
  });

  it('keeps 404 and data.unavailable as "unavailable", not errors', async () => {
    routes.timeline = (user) => user === 'alice'
      ? json({ error: 'not found' }, 404)
      : json({ status: 'success', data: { unavailable: true } });

    const result = await ingestArticles(fast);
    expect(result.errors).toBe(0);
    expect(result.skipped_unavailable).toBe(2);
  });

  it('aborts the run when global search answers 402', async () => {
    routes.search = () => json({ error: 'credits' }, 402);
    const err = await ingestArticles(fast).catch(e => e);
    expect(err).toBeInstanceOf(TwitterApiError);
    expect(err.status).toBe(402);
    expect(err.message).toContain('/tweet/advanced_search');
  });

  it('counts a 5xx from global search as an error without aborting', async () => {
    routes.search = () => json({ error: 'upstream' }, 500);
    const result = await ingestArticles(fast);
    expect(result.errors).toBe(1);
  });

  it('never logs the API key', async () => {
    routes.timeline = (user) => user === 'alice'
      ? json({ error: 'bad key sk-test-secret-key' }, 500)
      : json({ error: 'bad key sk-test-secret-key' }, 401);
    await runIngestion(fast);
    const text = loggedText();
    expect(text).toContain('/user/last_tweets responded 401');
    expect(text).toContain('[redacted]');
    expect(text).not.toContain('sk-test-secret-key');
  });
});

describe('ingestSingleArticle', () => {
  it('surfaces an upstream auth/quota error instead of "not an article"', async () => {
    routes.article = () => json({ error: 'credits' }, 402);
    const outcome = await ingestSingleArticle('123');
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('402');
    expect(outcome.error).toContain('/article');
    expect(outcome.error).not.toContain('not an article');
  });

  it('still reports "not an article" on 404', async () => {
    routes.article = () => json({ error: 'missing' }, 404);
    const outcome = await ingestSingleArticle('123');
    expect(outcome).toMatchObject({ ok: false, error: 'not an article or article not found' });
  });
});

describe('seed account loading', () => {
  it('fails the run on a Supabase error instead of using the fallback list', async () => {
    seeds = { data: null, error: { message: 'permission denied for table seed_accounts', code: '42501' } };
    await expect(ingestArticles(fast)).rejects.toThrow(/seed_accounts/);
    expect(timelineCalls()).toEqual([]);
    expect(loggedText()).toContain('permission denied');
  });

  it('uses the fallback list only when the table is empty, and says so', async () => {
    seeds = { data: [], error: null };
    await ingestArticles(fast);
    expect(timelineCalls()).toContain('RyanHoliday');
    expect((console.warn as any).mock.calls.flat().join(' ')).toMatch(/fallback/i);
  });
});

describe('dedup query', () => {
  it('passes a URL containing "," and ")" as a literal value, never as filter syntax', async () => {
    const nasty = 'https://x.com/writer/status/42?a=1,x_url.neq.foo)&b=(c)';
    seeds = { data: [{ handle: 'alice', high_yield: false }], error: null };
    routes.timeline = () => json({ status: 'success', data: { tweets: [articleTweet('42', nasty)] } });

    await ingestArticles(fast);

    const lookups = db.calls.filter(q => q.table === 'articles' && q.op === 'select');
    expect(lookups.flatMap(q => q.filters).some(f => f[0] === 'or')).toBe(false);
    expect(lookups.map(q => q.filters)).toEqual([
      [['eq', 'x_url', nasty]],
      [['eq', 'x_article_id', '42']],
    ]);
  });

  it('treats a match on either column as a duplicate', async () => {
    seeds = { data: [{ handle: 'alice', high_yield: false }], error: null };
    routes.timeline = () => json({ status: 'success', data: { tweets: [articleTweet('42')] } });
    db.respond = (q) => q.table === 'articles' && q.op === 'select' && q.filters[0][1] === 'x_article_id'
      ? { data: { id: 'existing' }, error: null }
      : defaultRespond(q);

    const result = await ingestArticles(fast);
    expect(result.skipped_duplicates).toBe(1);
    expect(db.calls.some(q => q.table === 'articles' && q.op === 'insert')).toBe(false);
  });
});

describe('supabase write errors', () => {
  beforeEach(() => {
    seeds = { data: [{ handle: 'alice', high_yield: false }], error: null };
    routes.timeline = () => json({ status: 'success', data: { tweets: [articleTweet('42')] } });
  });

  it('logs and counts a failed article insert', async () => {
    db.respond = (q) => q.table === 'articles' && q.op === 'insert'
      ? { data: null, error: { message: 'value too long', code: '22001' } }
      : defaultRespond(q);
    const result = await ingestArticles(fast);
    expect(result.errors).toBe(1);
    expect(loggedText()).toContain('value too long');
  });

  it('counts a unique violation on insert as a duplicate (concurrent workers)', async () => {
    db.respond = (q) => q.table === 'articles' && q.op === 'insert'
      ? { data: null, error: { message: 'duplicate key value', code: '23505' } }
      : defaultRespond(q);
    const result = await ingestArticles(fast);
    expect(result.skipped_duplicates).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('logs and counts a failed author upsert', async () => {
    db.respond = (q) => q.table === 'authors'
      ? { data: null, error: { message: 'authors exploded', code: 'XX000' } }
      : defaultRespond(q);
    const result = await ingestArticles(fast);
    expect(result.errors).toBe(1);
    expect(loggedText()).toContain('authors exploded');
  });

  it('logs stats and category link failures but keeps the article', async () => {
    db.respond = (q) => {
      if (q.table === 'categories') return { data: [{ id: 'c1', slug: 'tech' }], error: null };
      if (q.table === 'article_stats') return { data: null, error: { message: 'stats exploded' } };
      if (q.table === 'article_categories') return { data: null, error: { message: 'links exploded' } };
      return defaultRespond(q);
    };
    routes.timeline = () => json({ status: 'success', data: { tweets: [{
      ...articleTweet('42'), article: { title: 'New AI model and LLM agents', preview_text: 'gpt', contents: [{ text: 'ai' }] },
    }] } });

    const result = await ingestArticles(fast);
    expect(result.new_articles).toBe(1);
    const text = loggedText();
    expect(text).toContain('stats exploded');
    expect(text).toContain('links exploded');
  });

  it('fails the run when the category map cannot be loaded', async () => {
    db.respond = (q) => q.table === 'categories'
      ? { data: null, error: { message: 'categories unreachable' } }
      : defaultRespond(q);
    await expect(ingestArticles(fast)).rejects.toThrow(/categories/);
  });
});

describe('timeline concurrency and time budget', () => {
  it('fetches at most 3 timelines at once', async () => {
    seeds = { data: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(handle => ({ handle, high_yield: false })), error: null };
    let inFlight = 0;
    let peak = 0;
    routes.timeline = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 2));
      inFlight--;
      return json({ status: 'success', data: { tweets: [] } });
    };
    const result = await ingestArticles(fast);
    expect(result.accounts_checked).toBe(7);
    expect(peak).toBe(3);
  });

  it('skips remaining accounts once the timeline budget is spent, and reports it', async () => {
    const result = await ingestArticles({ delayMs: 0, timelineBudgetMs: -1 });
    expect(result.accounts_checked).toBe(0);
    expect(result.skipped_over_budget).toBe(2);
    expect(loggedText()).toMatch(/budget/i);
  });
});

describe('runIngestion (cron run record)', () => {
  const runWrites = () => db.calls.filter(q => q.table === 'ingest_runs');

  it("inserts a 'running' row first and marks it 'ok' with stats at the end", async () => {
    const outcome = await runIngestion(fast);

    expect(outcome.ok).toBe(true);
    const writes = runWrites();
    expect(writes[0]).toMatchObject({ op: 'insert', payload: { status: 'running' } });
    expect(db.calls[0].table).toBe('ingest_runs');
    const last = writes[writes.length - 1];
    expect(last.op).toBe('update');
    expect(last.filters).toEqual([['eq', 'id', 'run-1']]);
    expect(last.payload).toMatchObject({ status: 'ok', error: null, stats: { accounts_checked: 2 } });
    expect(typeof last.payload.finished_at).toBe('string');
  });

  it("marks the row 'failed' with the upstream status on an auth/quota abort", async () => {
    routes.timeline = () => json({ error: 'bad key' }, 401);
    const outcome = await runIngestion(fast);

    expect(outcome).toMatchObject({ ok: false, upstreamStatus: 401 });
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.error).toContain('401');
    const last = runWrites().at(-1)!;
    expect(last.payload).toMatchObject({ status: 'failed' });
    expect(last.payload.error).toContain('401');
  });

  it("marks the row 'failed' without an upstream status on a seed load error", async () => {
    seeds = { data: null, error: { message: 'seed read failed' } };
    const outcome = await runIngestion(fast);
    expect(outcome.ok).toBe(false);
    expect(outcome).not.toHaveProperty('upstreamStatus');
    expect(runWrites().at(-1)!.payload).toMatchObject({ status: 'failed' });
  });

  it('still ingests when the run row cannot be written', async () => {
    db.respond = (q) => q.table === 'ingest_runs'
      ? { data: null, error: { message: 'relation "ingest_runs" does not exist' } }
      : defaultRespond(q);
    const outcome = await runIngestion(fast);
    expect(outcome.ok).toBe(true);
    expect(timelineCalls()).toEqual(['alice', 'bob']);
    expect(runWrites().filter(q => q.op === 'update')).toEqual([]);
    expect(loggedText()).toContain('ingest_runs');
  });
});

describe('seed account rotation', () => {
  it('checks the least recently checked accounts first and stamps each one', async () => {
    await ingestArticles(fast);
    const seedRead = db.calls.find(q => q.table === 'seed_accounts' && q.op === 'select');
    expect(seedRead?.filters).toContainEqual(['order', 'last_checked_at', { ascending: true, nullsFirst: true }]);

    const stamps = db.calls.filter(q => q.table === 'seed_accounts' && q.op === 'update');
    expect(stamps.map(q => q.filters.find(f => f[1] === 'handle')?.[2]).sort()).toEqual(['alice', 'bob']);
    expect(stamps[0].payload).toHaveProperty('last_checked_at');
  });
});

describe('first source refresh from already-fetched payloads', () => {
  const stamp = '2026-10-01T00:00:00.123456+00:00';
  const stored = (id = '2110162929957953604') => ({
    id: `existing-${id}`, x_article_id: id, x_url: `https://x.com/writer/status/${id}`,
    author_id: 'author-1', author: { x_user_id: 'u1' }, status: 'published', featured: false,
    source: 'twitterapi', indexed_at: stamp, updated_at: stamp,
    title: 'Old', excerpt: 'Old', body_preview: 'Old', read_time_min: 1,
  });
  const changedTweet = (id = '2110162929957953604') => ({ ...articleTweet(id), article: {
    title: 'New substantive article', preview_text: 'New preview',
    contents: [{ text: 'Complete source paragraph with useful information. '.repeat(20) }],
  } });
  beforeEach(() => {
    seeds = { data: [{ handle: 'alice', high_yield: false }], error: null };
    routes.timeline = () => json({ status: 'success', data: { tweets: [changedTweet()] } });
    db.respond = q => {
      if (q.table !== 'articles') return defaultRespond(q);
      if (q.op === 'update') return { data: { id: 'existing-2110162929957953604' }, error: null };
      const [_, column, value] = q.filters[0];
      if (column === 'x_url') return { data: stored(String(value).split('/').pop()), error: null };
      if (column === 'id') return { data: stored(String(value).replace('existing-', '')), error: null };
      return defaultRespond(q);
    };
  });
  it('refreshes content without inserting or touching authors, categories or stats; uses no article API request', async () => {
    const result = await ingestArticles(fast);
    expect(result.refreshed_articles).toBe(1);
    expect(result.new_articles).toBe(0);
    expect(result.skipped_duplicates).toBe(0);
    const writes = db.calls.filter(q => q.op !== 'select' && q.table !== 'seed_accounts');
    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe('articles');
    expect(Object.keys(writes[0].payload).sort()).toEqual(['body_preview', 'excerpt', 'read_time_min', 'title']);
    expect(writes[0].filters).toEqual([
      ['eq', 'id', 'existing-2110162929957953604'], ['eq', 'x_article_id', '2110162929957953604'], ['eq', 'x_url', stored().x_url],
      ['eq', 'author_id', 'author-1'], ['eq', 'source', 'twitterapi'], ['eq', 'status', 'published'],
      ['eq', 'featured', false], ['eq', 'indexed_at', stamp], ['eq', 'updated_at', stamp],
    ]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/article?'))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2); // existing timeline + search, no refresh requests
  });
  it('reserves a shared bound of 20 attempts across concurrent seed workers', async () => {
    seeds = { data: [{ handle: 'alice' }, { handle: 'bob' }], error: null };
    routes.timeline = user => json({ status: 'success', data: { tweets:
      Array.from({ length: 20 }, (_, i) => changedTweet(String(BigInt('2110162929957900000') + BigInt((user === 'alice' ? 100 : 200) + i)))),
    } });
    const result = await ingestArticles(fast);
    expect(result.refreshed_articles).toBe(20);
    expect(result.skipped_duplicates).toBe(20);
    expect(db.calls.filter(q => q.table === 'articles' && q.op === 'update')).toHaveLength(20);
    expect(db.calls.filter(q => q.table === 'articles' && q.op === 'select')).toHaveLength(40);
  });
  it('does not let ineligible duplicates spend the eligible write budget', async () => {
    routes.timeline = () => json({ status: 'success', data: { tweets:
      Array.from({ length: 25 }, (_, i) => changedTweet(String(BigInt('2110162929957900000') + BigInt(i)))),
    } });
    const previous = db.respond;
    db.respond = q => {
      const reply = previous(q);
      if (q.table === 'articles' && q.op === 'select' && reply.data &&
          BigInt(reply.data.x_article_id) < BigInt('2110162929957900024')) {
        reply.data.source = 'manual';
      }
      return reply;
    };
    const result = await ingestArticles(fast);
    expect(result.refreshed_articles).toBe(1);
    expect(result.skipped_duplicates).toBe(24);
  });
  it('does not attempt the same existing row twice across seed and search responses', async () => {
    routes.search = () => json({ status: 'success', tweets: [changedTweet()] });
    const result = await ingestArticles(fast);
    expect(result.refreshed_articles).toBe(1);
    expect(db.calls.filter(q => q.table === 'articles' && q.op === 'update')).toHaveLength(1);
  });
  it('counts a concurrent edit that no longer matches compare-and-set as skipped', async () => {
    const previous = db.respond;
    db.respond = q => q.table === 'articles' && q.op === 'update' ? { data: null, error: null } : previous(q);
    const result = await ingestArticles(fast);
    expect(result.refreshed_articles).toBe(0);
    expect(result.skipped_duplicates).toBe(1);
    expect(result.errors).toBe(0);
  });
  it.each(['select', 'update'])('counts refresh %s errors without a fallback insert', async op => {
    const previous = db.respond;
    db.respond = q => q.table === 'articles' && q.op === op
      ? { data: null, error: { message: 'synthetic DB failure' } } : previous(q);
    const result = await ingestArticles(fast);
    expect(result.refreshed_articles).toBe(0);
    expect(result.errors).toBe(1);
    expect(db.calls.some(q => q.table === 'articles' && q.op === 'insert')).toBe(false);
  });
  it('leaves a previously moderated row untouched', async () => {
    const previous = db.respond;
    db.respond = q => q.table === 'articles' && q.op === 'select'
      ? { data: { ...stored(), status: 'hidden' }, error: null } : previous(q);
    const result = await ingestArticles(fast);
    expect(result.skipped_duplicates).toBe(1);
    expect(db.calls.some(q => q.table === 'articles' && q.op === 'update')).toBe(false);
  });
});
