/**
 * Linkdrift ingestion core (shared by /api/ingest and the admin approve route)
 *
 * Two discovery strategies:
 * 1. Timeline scan: fetch timelines from seed accounts (hardcoded + DB).
 *    The timeline response has an `article` field on each tweet — non-null = article.
 * 2. Global search: search for "x.com/i/article" to find articles from any account.
 *
 * Failure policy:
 * - twitterapi.io 401/402/403/429 (bad key, out of credits, forbidden, rate
 *   limited) aborts the whole run: every later request would fail the same way.
 * - 5xx and network errors are counted per account and the run continues.
 * - 404 and `data.unavailable` mean the account or tweet is gone.
 * - Supabase errors are logged; a failed seed or category load fails the run.
 *
 * Cron config in vercel.json:
 * { "crons": [{ "path": "/api/ingest", "schedule": "0 0 * * *" }] }
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { classifyArticle, estimateReadTime, isEnglishLike, usableArticleBody, articleTeaser } from '@/lib/ingest-utils';
import { isBlockedTitle } from '@/lib/title-filter';
import { runWithConcurrency } from '@/lib/concurrency';
import { sourceRefreshPatch, type RefreshableArticle } from './article-source-refresh';

// ─── Config ──────────────────────────────────────────────────────────

const TWITTERAPI_KEY = process.env.TWITTERAPI_IO_KEY!;
const TWITTERAPI_BASE = 'https://api.twitterapi.io/twitter';

// Fallback seed list — DB seed_accounts table is the primary source.
// Used only when the table has no approved rows; a query error fails the run.
const FALLBACK_SEED_ACCOUNTS = [
  'Decentralisedco', 'NotBatmanDev', 'DefiIgnas', 'CryptoCred',
  'Rewkang', 'tokenterminal', 'sierracatalina', 'RyanHoliday', 'drjimfan',
];

const MAX_PAGES_DEFAULT = 1;
const MAX_PAGES_HIGH_YIELD = 3;
const GLOBAL_SEARCH_PAGES = 3; // ~60 articles from global search

// The route runs with maxDuration = 60 (Vercel Hobby max). The timeline phase
// stops dispatching new accounts after TIMELINE_BUDGET_MS so global search
// still gets a turn, and global search stops ingesting at RUN_BUDGET_MS so the
// run record can be closed before the function is killed.
const TIMELINE_CONCURRENCY = 3;
const POLITENESS_DELAY_MS = 300;
const TIMELINE_BUDGET_MS = 35_000;
const RUN_BUDGET_MS = 50_000;

// ─── TwitterAPI.io Types ─────────────────────────────────────────────

interface AuthorInfo {
  id: string;
  userName: string;
  name: string;
  profilePicture: string;
  isBlueVerified: boolean;
  isVerified?: boolean;
  followers: number;
}

interface ArticleContent {
  title: string;
  preview_text: string;
  cover_media_img_url?: string;
  contents?: Array<{ text?: string }>;
}

interface TimelineTweet {
  id: string;
  text: string;
  type: string;
  createdAt: string;
  url: string;
  author: AuthorInfo;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  bookmarkCount: number;
  quoteCount: number;
  viewCount: number | string;
  // Non-null when tweet is an X Article
  article: ArticleContent | null;
}

interface UserTimelineResponse {
  status: string;
  data?: {
    tweets?: TimelineTweet[];
    unavailable?: boolean;
  };
  tweets?: TimelineTweet[];
  has_next_page?: boolean;
  next_cursor?: string;
}

interface ArticleData extends ArticleContent {
  author: AuthorInfo;
  createdAt: string;
  likeCount: number;
  replyCount: number;
  quoteCount: number;
  viewCount: number | string;
}

// ─── Quality Filters (global search only) ───────────────────────────
// Seed account articles skip these — they're already vetted.
// Global search pulls from anyone, so we filter for traction.

const MIN_LIKES = 5;
const MIN_FOLLOWERS = 100;
const MIN_ENGAGEMENT = 10; // likes + retweets + replies + bookmarks

function meetsQualityThreshold(tweet: TimelineTweet): boolean {
  // Language filter: skip non-Latin titles (CJK, Arabic, Cyrillic, etc.)
  const title = tweet.article?.title || '';
  if (!isEnglishLike(title)) return false;

  const likes = tweet.likeCount ?? 0;
  const followers = tweet.author?.followers ?? 0;
  const totalEngagement =
    likes +
    (tweet.retweetCount ?? 0) +
    (tweet.replyCount ?? 0) +
    (tweet.bookmarkCount ?? 0);

  // High-value account: verified with 10k+ followers gets a pass
  if (followers >= 10_000 && (tweet.author?.isBlueVerified || tweet.author?.isVerified)) {
    return true;
  }

  return likes >= MIN_LIKES && followers >= MIN_FOLLOWERS && totalEngagement >= MIN_ENGAGEMENT;
}

// ─── Errors ──────────────────────────────────────────────────────────

// Statuses where retrying the next account cannot help: bad or missing key,
// out of credits, forbidden, rate limited.
const FATAL_UPSTREAM_STATUSES = new Set([401, 402, 403, 429]);

/**
 * A failed twitterapi.io request. `status` is the HTTP status, or 0 when the
 * request never got a response. `fatal` errors abort the ingest run.
 * The message names the endpoint path only; the API key is never included.
 */
export class TwitterApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly fatal: boolean;

  constructor(endpoint: string, status: number, detail?: string) {
    const what = status === 0 ? 'request failed' : `responded ${status}`;
    super(`twitterapi.io ${endpoint} ${what}${detail ? `: ${detail}` : ''}`);
    this.name = 'TwitterApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.fatal = FATAL_UPSTREAM_STATUSES.has(status);
  }
}

function isFatal(err: unknown): err is TwitterApiError {
  return err instanceof TwitterApiError && err.fatal;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function dbErrorMessage(error: { message: string; code?: string }): string {
  return error.code ? `${error.message} (${error.code})` : error.message;
}

// Upstream bodies and network errors are echoed into logs and the run record.
function redactKey(text: string): string {
  return TWITTERAPI_KEY ? text.split(TWITTERAPI_KEY).join('[redacted]') : text;
}

// ─── API Helpers ─────────────────────────────────────────────────────

/**
 * GET a twitterapi.io endpoint. Returns null on 404 and throws
 * TwitterApiError on any other non-2xx or network failure.
 */
async function twitterGet<T>(endpoint: string, params: URLSearchParams): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${TWITTERAPI_BASE}${endpoint}?${params}`, {
      headers: { 'X-API-Key': TWITTERAPI_KEY },
    });
  } catch (err) {
    throw new TwitterApiError(endpoint, 0, redactKey(errorMessage(err)));
  }

  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new TwitterApiError(endpoint, res.status, redactKey(body.slice(0, 200)));
  }
  return (await res.json()) as T;
}

interface TimelinePage {
  tweets: TimelineTweet[];
  nextCursor?: string;
}

async function fetchTimelinePage(userName: string, cursor?: string): Promise<TimelinePage> {
  const params = new URLSearchParams({ userName });
  if (cursor) params.set('cursor', cursor);

  const json = await twitterGet<UserTimelineResponse>('/user/last_tweets', params);
  if (!json || json.data?.unavailable) return { tweets: [] };

  const tweets = json.data?.tweets || json.tweets || [];
  return {
    tweets: Array.isArray(tweets) ? tweets : [],
    nextCursor: json.has_next_page ? json.next_cursor : undefined,
  };
}

async function fetchUserTimeline(userName: string, maxPages: number, delayMs: number): Promise<TimelineTweet[]> {
  const allTweets: TimelineTweet[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const result = await fetchTimelinePage(userName, cursor);
    allTweets.push(...result.tweets);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
    if (page < maxPages - 1) await sleep(delayMs);
  }

  return allTweets;
}

/** Returns null when the tweet is missing or is not an article. Throws TwitterApiError otherwise. */
async function probeArticle(tweetId: string): Promise<ArticleData | null> {
  const params = new URLSearchParams({ tweet_id: tweetId });
  const json = await twitterGet<{ status?: string; article?: ArticleData }>('/article', params);
  if (!json || json.status !== 'success' || !json.article) return null;
  return json.article;
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ─── Global Article Search ──────────────────────────────────────────
//
// Searches X for tweets containing "x.com/i/article" — these are
// article tweets from ANY account, not just our seed list.
// This is how we discover new article writers organically.

interface SearchResponse {
  status: string;
  data?: { tweets?: TimelineTweet[] };
  tweets?: TimelineTweet[];
  has_next_page?: boolean;
  next_cursor?: string;
}

/**
 * Fatal upstream errors are thrown. A non-fatal error ends the search early
 * and is returned alongside the pages already fetched, so they still get ingested.
 */
async function searchGlobalArticles(
  maxPages: number,
  delayMs: number,
): Promise<{ tweets: TimelineTweet[]; error?: unknown }> {
  const allTweets: TimelineTweet[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      queryType: 'Latest',
      query: 'x.com/i/article',
    });
    if (cursor) params.set('cursor', cursor);

    let json: SearchResponse | null;
    try {
      json = await twitterGet<SearchResponse>('/tweet/advanced_search', params);
    } catch (err) {
      if (isFatal(err)) throw err;
      return { tweets: allTweets, error: err };
    }
    if (!json) break;

    const tweets = json.data?.tweets || json.tweets || [];
    const articleTweets = (Array.isArray(tweets) ? tweets : []).filter(t => t.article);
    allTweets.push(...articleTweets);

    if (!json.has_next_page || !json.next_cursor) break;
    cursor = json.next_cursor;
    if (page < maxPages - 1) await sleep(delayMs);
  }

  return { tweets: allTweets };
}

// ─── Seed Account Loader ────────────────────────────────────────────

interface SeedAccount {
  handle: string;
  highYield: boolean;
}

async function loadSeedAccounts(): Promise<SeedAccount[]> {
  const { data, error } = await supabaseAdmin
    .from('seed_accounts')
    .select('handle, high_yield')
    .eq('status', 'approved')
    // Least recently checked first, so accounts cut off by the time budget
    // lead the next run instead of being skipped every night.
    .order('last_checked_at', { ascending: true, nullsFirst: true });

  if (error) {
    const message = `seed_accounts query failed: ${dbErrorMessage(error)}`;
    console.error(`[ingest] ${message}`);
    throw new Error(message);
  }

  if (data && data.length > 0) {
    return data.map(row => ({ handle: row.handle, highYield: row.high_yield }));
  }

  console.warn(
    `[ingest] seed_accounts has no approved rows; using ${FALLBACK_SEED_ACCOUNTS.length} fallback handles`,
  );
  return FALLBACK_SEED_ACCOUNTS.map(handle => ({ handle, highYield: false }));
}

async function markSeedChecked(handle: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('seed_accounts')
    .update({ last_checked_at: new Date().toISOString() })
    .eq('handle', handle);
  if (error) console.error(`[ingest] stamping @${handle} last_checked_at failed: ${dbErrorMessage(error)}`);
}

// ─── Shared Article Processing ──────────────────────────────────────
//
//  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐
//  │ timeline    │   │ global search│   │ probeArticle │
//  │ tweet.article│  │ x.com/i/article  │ /article?id  │
//  └──────┬──────┘   └──────┬───────┘   └──────┬───────┘
//         │                 │ normalize          │
//         └────────┬────────┘                   │
//                  ▼                            ▼
//   processArticle(tweetId, articleContent, authorInfo, ...)
//         │
//         ├─ upsert author
//         ├─ classify
//         ├─ insert article
//         ├─ link categories
//         └─ upsert stats

interface ProcessArticleInput {
  tweetId: string;
  tweetUrl: string;
  article: ArticleContent;
  author: AuthorInfo;
  publishedAt: string;
  stats: {
    likeCount: number;
    bookmarkCount: number;
    replyCount: number;
    retweetCount: number;
  };
  catMap: Map<string, string>;
}

export interface IngestOutcome {
  ok: boolean;
  title?: string;
  error?: string;
  blocked?: boolean;
  duplicate?: boolean;
  articleId?: string;
}

// PostgreSQL unique_violation. articles.x_url and articles.x_article_id are
// both UNIQUE, so this means another worker inserted the same tweet first.
const UNIQUE_VIOLATION = '23505';

async function processArticle(input: ProcessArticleInput): Promise<IngestOutcome> {
  const { tweetId, tweetUrl, article, author: authorSource, publishedAt, stats, catMap } = input;

  // Blocklisted titles are dropped before any database write.
  if (isBlockedTitle(article.title)) return { ok: false, blocked: true, error: 'blocked title' };

  const cleanText = usableArticleBody(article.contents, article.preview_text || '');
  const excerpt = articleTeaser(article.preview_text, cleanText);
  const bodyPreview = cleanText?.slice(0, 500) || null;
  const coverImage = article.cover_media_img_url || null;
  const readTime = cleanText ? estimateReadTime(cleanText) : null;

  // Upsert author
  const { data: author, error: authorErr } = await supabaseAdmin
    .from('authors')
    .upsert({
      x_user_id: authorSource.id,
      handle: authorSource.userName,
      display_name: authorSource.name,
      avatar_url: authorSource.profilePicture,
      verified: authorSource.isBlueVerified || authorSource.isVerified || false,
      follower_count: authorSource.followers || 0,
    }, { onConflict: 'x_user_id' })
    .select('id')
    .single();

  if (authorErr || !author) {
    const detail = authorErr ? dbErrorMessage(authorErr) : 'no row returned';
    console.error(`[ingest] author upsert failed for @${authorSource.userName} (tweet ${tweetId}): ${detail}`);
    return { ok: false, error: 'failed to upsert author' };
  }

  // Classify
  const categorySlugs = classifyArticle(article.title, excerpt || '');

  // Insert article
  const { data: newArticle, error: articleErr } = await supabaseAdmin
    .from('articles')
    .insert({
      x_article_id: tweetId,
      x_url: tweetUrl,
      title: article.title || 'Untitled',
      excerpt,
      body_preview: bodyPreview,
      author_id: author.id,
      cover_image_url: coverImage,
      read_time_min: readTime,
      status: 'published',
      source: 'twitterapi',
      published_at: publishedAt,
    })
    .select('id')
    .single();

  if (articleErr?.code === UNIQUE_VIOLATION) {
    return { ok: false, duplicate: true, error: 'already exists' };
  }
  if (articleErr || !newArticle) {
    const detail = articleErr ? dbErrorMessage(articleErr) : 'no row returned';
    console.error(`[ingest] article insert failed for tweet ${tweetId}: ${detail}`);
    return { ok: false, error: 'failed to insert article' };
  }

  // Link categories. The article already exists, so a failure here is logged
  // and the ingest still counts as new.
  const categoryLinks = categorySlugs
    .map(slug => catMap.get(slug))
    .filter(Boolean)
    .map(catId => ({ article_id: newArticle.id, category_id: catId! }));

  if (categoryLinks.length > 0) {
    const { error: linkErr } = await supabaseAdmin
      .from('article_categories')
      .insert(categoryLinks);
    if (linkErr) {
      console.error(`[ingest] category link failed for article ${newArticle.id}: ${dbErrorMessage(linkErr)}`);
    }
  }

  // Upsert engagement stats (upsert avoids race condition with DB triggers)
  const { error: statsErr } = await supabaseAdmin
    .from('article_stats')
    .upsert({
      article_id: newArticle.id,
      like_count: stats.likeCount,
      bookmark_count: stats.bookmarkCount,
      comment_count: stats.replyCount,
      share_count: stats.retweetCount,
    }, { onConflict: 'article_id' });
  if (statsErr) {
    console.error(`[ingest] stats upsert failed for article ${newArticle.id}: ${dbErrorMessage(statsErr)}`);
  }

  return { ok: true, title: article.title, articleId: newArticle.id };
}

// ─── Category Map Loader ────────────────────────────────────────────

async function loadCategoryMap(): Promise<Map<string, string>> {
  const { data: categories, error } = await supabaseAdmin
    .from('categories')
    .select('id, slug');
  if (error) {
    const message = `categories query failed: ${dbErrorMessage(error)}`;
    console.error(`[ingest] ${message}`);
    throw new Error(message);
  }
  return new Map((categories || []).map(c => [c.slug, c.id]));
}

// ─── Dedup ──────────────────────────────────────────────────────────

/**
 * Returns an article matching either the tweet URL or the tweet id.
 * Two parameterized lookups: values are never spliced into PostgREST filter
 * syntax, so a URL containing ',' or ')' cannot change the query.
 */
const REFRESH_COLUMNS = 'id,x_article_id,x_url,author_id,author:authors(x_user_id),source,status,featured,indexed_at,updated_at,title,excerpt,body_preview,read_time_min';

async function findExistingArticle(tweetUrl: string, tweetId: string): Promise<RefreshableArticle | null> {
  const byUrl = await supabaseAdmin
    .from('articles')
    .select(REFRESH_COLUMNS)
    .eq('x_url', tweetUrl)
    .maybeSingle();
  if (byUrl.error) throw new Error(`articles lookup by x_url failed: ${dbErrorMessage(byUrl.error)}`);
  if (byUrl.data) return byUrl.data as unknown as RefreshableArticle;

  const byId = await supabaseAdmin
    .from('articles')
    .select(REFRESH_COLUMNS)
    .eq('x_article_id', tweetId)
    .maybeSingle();
  if (byId.error) throw new Error(`articles lookup by x_article_id failed: ${dbErrorMessage(byId.error)}`);
  return byId.data as unknown as RefreshableArticle | null;
}

// ─── Ingestion Logic ─────────────────────────────────────────────────

// A type alias (not an interface) so it is assignable to the Json column type.
export type IngestResult = {
  accounts_checked: number;
  tweets_scanned: number;
  articles_found: number;
  new_articles: number;
  skipped_duplicates: number;
  /** Untouched imported rows refreshed from already-fetched timeline/search data. */
  refreshed_articles: number;
  skipped_low_quality: number;
  skipped_unavailable: number;
  skipped_blocked: number;
  /** Seed accounts not scanned because the timeline time budget ran out. */
  skipped_over_budget: number;
  errors: number;
  global_search_articles: number;
  cost_estimate_usd: number;
  duration_ms: number;
};

export interface IngestOptions {
  /** Pause between requests to twitterapi.io, per worker. */
  delayMs?: number;
  /** Stop dispatching new seed accounts after this many ms. */
  timelineBudgetMs?: number;
  /** Stop ingesting global search results after this many ms. */
  runBudgetMs?: number;
}

function emptyResult(): IngestResult {
  return {
    accounts_checked: 0,
    tweets_scanned: 0,
    articles_found: 0,
    new_articles: 0,
    skipped_duplicates: 0,
    refreshed_articles: 0,
    skipped_low_quality: 0,
    skipped_unavailable: 0,
    skipped_blocked: 0,
    skipped_over_budget: 0,
    errors: 0,
    global_search_articles: 0,
    cost_estimate_usd: 0,
    duration_ms: 0,
  };
}

async function ingestArticleTweet(
  tweet: TimelineTweet,
  handle: string,
  catMap: Map<string, string>,
  refreshBudget: { remaining: number; seen: Set<string> },
): Promise<'new' | 'refreshed' | 'duplicate' | 'blocked' | 'error'> {
  if (!tweet.article) return 'error';

  const tweetUrl = tweet.url || `https://x.com/${handle}/status/${tweet.id}`;
  try {
    const row = await findExistingArticle(tweetUrl, tweet.id);
    if (row) {
      if (refreshBudget.remaining <= 0 || refreshBudget.seen.has(row.id)) return 'duplicate';
      refreshBudget.seen.add(row.id);
      const patch = sourceRefreshPatch(row, {
        tweetId: tweet.id, tweetUrl, authorId: tweet.author?.id, article: tweet.article,
      });
      if (!patch) return 'duplicate';
      // Reserve before awaiting: concurrent seed workers share this per-run cap.
      refreshBudget.remaining--;
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('articles').update(patch)
        .eq('id', row.id).eq('x_article_id', row.x_article_id!)
        .eq('x_url', row.x_url).eq('author_id', row.author_id)
        .eq('source', 'twitterapi').eq('status', 'published').eq('featured', false)
        .eq('indexed_at', row.indexed_at!).eq('updated_at', row.updated_at!)
        .select('id').maybeSingle();
      if (updateError) throw new Error(`refresh update failed: ${dbErrorMessage(updateError)}`);
      return updated ? 'refreshed' : 'duplicate';
    }
  } catch (err) {
    console.error(`[ingest] dedup check failed for tweet ${tweet.id}: ${errorMessage(err)}`);
    return 'error';
  }

  const result = await processArticle({
    tweetId: tweet.id,
    tweetUrl,
    article: tweet.article,
    author: tweet.author,
    publishedAt: tweet.createdAt,
    stats: {
      likeCount: tweet.likeCount ?? 0,
      bookmarkCount: tweet.bookmarkCount ?? 0,
      replyCount: tweet.replyCount ?? 0,
      retweetCount: tweet.retweetCount ?? 0,
    },
    catMap,
  });

  if (result.blocked) return 'blocked';
  if (result.duplicate) return 'duplicate';
  return result.ok ? 'new' : 'error';
}

/**
 * Scan seed timelines and global search. Counters are written into `stats` as
 * the run progresses, so a caller that catches a thrown abort still has the
 * partial totals. Throws TwitterApiError on a fatal upstream status, and Error
 * when the seed or category tables cannot be read.
 */
export async function ingestArticles(
  options: IngestOptions = {},
  stats: IngestResult = emptyResult(),
): Promise<IngestResult> {
  const {
    delayMs = POLITENESS_DELAY_MS,
    timelineBudgetMs = TIMELINE_BUDGET_MS,
    runBudgetMs = RUN_BUDGET_MS,
  } = options;
  const start = Date.now();
  // At most 20 content-only writes; reuse dedup reads and existing upstream calls.
  const refreshBudget = { remaining: 20, seen: new Set<string>() };
  const elapsed = () => Date.now() - start;

  try {
    const catMap = await loadCategoryMap();
    const seedAccounts = await loadSeedAccounts();

    // ── Phase 1: Timeline scan of seed accounts ──
    stats.skipped_over_budget = await runWithConcurrency(
      seedAccounts,
      TIMELINE_CONCURRENCY,
      async ({ handle, highYield }) => {
        try {
          const pages = highYield ? MAX_PAGES_HIGH_YIELD : MAX_PAGES_DEFAULT;
          const tweets = await fetchUserTimeline(handle, pages, delayMs);
          stats.accounts_checked++;
          await markSeedChecked(handle);

          if (tweets.length === 0) {
            stats.skipped_unavailable++;
          }

          for (const tweet of tweets) {
            stats.tweets_scanned++;
            if (!tweet.article) continue;
            stats.articles_found++;

            const outcome = await ingestArticleTweet(tweet, handle, catMap, refreshBudget);
            if (outcome === 'new') stats.new_articles++;
            else if (outcome === 'refreshed') stats.refreshed_articles++;
            else if (outcome === 'duplicate') stats.skipped_duplicates++;
            else if (outcome === 'blocked') stats.skipped_blocked++;
            else stats.errors++;
          }
        } catch (err) {
          if (isFatal(err)) throw err;
          console.error(`[ingest] @${handle}: ${errorMessage(err)}`);
          stats.errors++;
        }
        await sleep(delayMs);
      },
      () => elapsed() < timelineBudgetMs,
    );

    if (stats.skipped_over_budget > 0) {
      console.warn(
        `[ingest] timeline budget of ${timelineBudgetMs}ms spent; ` +
        `skipped ${stats.skipped_over_budget} of ${seedAccounts.length} seed accounts`,
      );
    }

    // ── Phase 2: Global article search ──
    // Finds articles from anyone on X. Quality-filtered to skip spam/low-traction.
    if (elapsed() >= runBudgetMs) {
      console.warn(`[ingest] run budget of ${runBudgetMs}ms spent; skipping global search`);
      return stats;
    }

    try {
      const { tweets: globalTweets, error: searchErr } = await searchGlobalArticles(GLOBAL_SEARCH_PAGES, delayMs);
      if (searchErr) {
        console.error(`[ingest] global search: ${errorMessage(searchErr)}`);
        stats.errors++;
      }

      for (let i = 0; i < globalTweets.length; i++) {
        if (elapsed() >= runBudgetMs) {
          console.warn(
            `[ingest] run budget of ${runBudgetMs}ms spent; ` +
            `left ${globalTweets.length - i} global search results unprocessed`,
          );
          break;
        }

        const tweet = globalTweets[i];
        stats.tweets_scanned++;
        stats.articles_found++;

        if (!meetsQualityThreshold(tweet)) {
          stats.skipped_low_quality++;
          continue;
        }

        const handle = tweet.author?.userName || 'unknown';
        const outcome = await ingestArticleTweet(tweet, handle, catMap, refreshBudget);
        if (outcome === 'new') {
          stats.new_articles++;
          stats.global_search_articles++;
        } else if (outcome === 'refreshed') {
          stats.refreshed_articles++;
        } else if (outcome === 'duplicate') {
          stats.skipped_duplicates++;
        } else if (outcome === 'blocked') {
          stats.skipped_blocked++;
        } else {
          stats.errors++;
        }
      }
    } catch (err) {
      if (isFatal(err)) throw err;
      console.error(`[ingest] global search: ${errorMessage(err)}`);
      stats.errors++;
    }

    return stats;
  } finally {
    const costEstimate = (stats.accounts_checked + GLOBAL_SEARCH_PAGES) * 0.003;
    stats.cost_estimate_usd = Math.round(costEstimate * 10000) / 10000;
    stats.duration_ms = elapsed();
  }
}

// ─── Cron Run (persisted to ingest_runs) ────────────────────────────

export type IngestRunOutcome =
  | { ok: true; result: IngestResult }
  | { ok: false; result: IngestResult; error: string; upstreamStatus?: number };

async function startRun(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('ingest_runs')
    .insert({ status: 'running' })
    .select('id')
    .single();
  if (error || !data) {
    // Recording the run is observability only; ingest without it.
    console.error(`[ingest] could not create ingest_runs row: ${error ? dbErrorMessage(error) : 'no row returned'}`);
    return null;
  }
  return data.id;
}

async function finishRun(runId: string | null, outcome: IngestRunOutcome): Promise<void> {
  if (!runId) return;
  const { error } = await supabaseAdmin
    .from('ingest_runs')
    .update({
      status: outcome.ok ? 'ok' : 'failed',
      finished_at: new Date().toISOString(),
      stats: outcome.result,
      error: outcome.ok ? null : outcome.error,
    })
    .eq('id', runId);
  if (error) {
    console.error(`[ingest] could not update ingest_runs row ${runId}: ${dbErrorMessage(error)}`);
  }
}

/**
 * Cron entry point. Inserts a 'running' row in ingest_runs, runs the ingest,
 * then marks the row 'ok' or 'failed'. A run killed by the platform timeout
 * leaves its row in 'running'.
 */
export async function runIngestion(options: IngestOptions = {}): Promise<IngestRunOutcome> {
  const runId = await startRun();
  const stats = emptyResult();

  let outcome: IngestRunOutcome;
  try {
    await ingestArticles(options, stats);
    outcome = { ok: true, result: stats };
  } catch (err) {
    const error = errorMessage(err);
    console.error(`[ingest] run failed: ${error}`);
    outcome = isFatal(err)
      ? { ok: false, result: stats, error, upstreamStatus: err.status }
      : { ok: false, result: stats, error };
  }

  await finishRun(runId, outcome);
  return outcome;
}

// ─── Single Article Ingestion (by tweet ID) ─────────────────────────

/** Never throws: every failure, including upstream errors, is returned as `error`. */
export async function ingestSingleArticle(tweetId: string): Promise<IngestOutcome> {
  try {
    const catMap = await loadCategoryMap();

    // Dedup check
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('articles')
      .select('id')
      .eq('x_article_id', tweetId)
      .maybeSingle();
    if (existingErr) {
      throw new Error(`articles lookup by x_article_id failed: ${dbErrorMessage(existingErr)}`);
    }

    if (existing) return { ok: false, error: 'already exists', articleId: existing.id };

    // Fetch article via probe endpoint (manual submission doesn't have timeline context)
    const article = await probeArticle(tweetId);
    if (!article) return { ok: false, error: 'not an article or article not found' };

    const tweetUrl = `https://x.com/${article.author.userName}/status/${tweetId}`;

    return await processArticle({
      tweetId,
      tweetUrl,
      article,
      author: article.author,
      publishedAt: article.createdAt,
      stats: {
        likeCount: article.likeCount ?? 0,
        bookmarkCount: 0,
        replyCount: article.replyCount ?? 0,
        retweetCount: 0,
      },
      catMap,
    });
  } catch (err) {
    const error = errorMessage(err);
    console.error(`[ingest] single ingest of tweet ${tweetId} failed: ${error}`);
    return { ok: false, error };
  }
}
