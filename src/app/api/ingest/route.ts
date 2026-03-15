/**
 * Linkdrift Ingestion Worker
 *
 * Two discovery strategies:
 * 1. Timeline scan: fetch timelines from seed accounts (hardcoded + DB).
 *    The timeline response has an `article` field on each tweet — non-null = article.
 * 2. Global search: search for "x.com/i/article" to find articles from any account.
 *
 * Cron config in vercel.json:
 * { "crons": [{ "path": "/api/ingest", "schedule": "0 0 * * *" }] }
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { NextResponse, NextRequest } from 'next/server';
import { classifyArticle, stripHtml, estimateReadTime } from './utils';

// ─── Config ──────────────────────────────────────────────────────────

const TWITTERAPI_KEY = process.env.TWITTERAPI_IO_KEY!;
const TWITTERAPI_BASE = 'https://api.twitterapi.io/twitter';

// Fallback seed list — DB seed_accounts table is the primary source.
// These are checked if the DB query fails or returns empty.
const FALLBACK_SEED_ACCOUNTS = [
  'Decentralisedco', 'NotBatmanDev', 'DefiIgnas', 'CryptoCred',
  'Rewkang', 'tokenterminal', 'sierracatalina', 'RyanHoliday', 'drjimfan',
];

const MAX_PAGES_DEFAULT = 1;
const MAX_PAGES_HIGH_YIELD = 3;
const GLOBAL_SEARCH_PAGES = 3; // ~60 articles from global search

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
  contents: Array<{ text: string }>;
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

// ─── API Helpers ─────────────────────────────────────────────────────

interface TimelinePage {
  tweets: TimelineTweet[];
  nextCursor?: string;
}

async function fetchTimelinePage(userName: string, cursor?: string): Promise<TimelinePage> {
  const params = new URLSearchParams({ userName });
  if (cursor) params.set('cursor', cursor);

  const res = await fetch(`${TWITTERAPI_BASE}/user/last_tweets?${params}`, {
    headers: { 'X-API-Key': TWITTERAPI_KEY },
  });

  if (!res.ok) return { tweets: [] };

  const json: UserTimelineResponse = await res.json();
  if (json.data?.unavailable) return { tweets: [] };

  const tweets = json.data?.tweets || json.tweets || [];
  return {
    tweets: Array.isArray(tweets) ? tweets : [],
    nextCursor: json.has_next_page ? json.next_cursor : undefined,
  };
}

async function fetchUserTimeline(userName: string, maxPages = 1): Promise<TimelineTweet[]> {
  const allTweets: TimelineTweet[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const result = await fetchTimelinePage(userName, cursor);
    allTweets.push(...result.tweets);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
    if (page < maxPages - 1) await sleep(300);
  }

  return allTweets;
}

async function probeArticle(tweetId: string): Promise<ArticleData | null> {
  const params = new URLSearchParams({ tweet_id: tweetId });
  const res = await fetch(`${TWITTERAPI_BASE}/article?${params}`, {
    headers: { 'X-API-Key': TWITTERAPI_KEY },
  });

  if (!res.ok) return null;

  const json = await res.json();
  if (json.status !== 'success' || !json.article) return null;
  return json.article;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

async function searchGlobalArticles(maxPages = 1): Promise<TimelineTweet[]> {
  const allTweets: TimelineTweet[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      queryType: 'Latest',
      query: 'x.com/i/article',
    });
    if (cursor) params.set('cursor', cursor);

    const res = await fetch(
      `${TWITTERAPI_BASE}/tweet/advanced_search?${params}`,
      { headers: { 'X-API-Key': TWITTERAPI_KEY } }
    );

    if (!res.ok) break;

    const json: SearchResponse = await res.json();
    const tweets = json.data?.tweets || json.tweets || [];
    const articleTweets = (Array.isArray(tweets) ? tweets : []).filter(t => t.article);
    allTweets.push(...articleTweets);

    if (!json.has_next_page || !json.next_cursor) break;
    cursor = json.next_cursor;
    if (page < maxPages - 1) await sleep(300);
  }

  return allTweets;
}

// ─── Seed Account Loader ────────────────────────────────────────────

interface SeedAccount {
  handle: string;
  highYield: boolean;
}

async function loadSeedAccounts(): Promise<SeedAccount[]> {
  const { data } = await supabaseAdmin
    .from('seed_accounts')
    .select('handle, high_yield')
    .eq('status', 'approved');

  if (data && data.length > 0) {
    return data.map(row => ({ handle: row.handle, highYield: row.high_yield }));
  }

  // Fallback to hardcoded list if DB is empty/unreachable
  return FALLBACK_SEED_ACCOUNTS.map(handle => ({ handle, highYield: false }));
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
  fallbackText: string;
  stats: {
    likeCount: number;
    bookmarkCount: number;
    replyCount: number;
    retweetCount: number;
  };
  catMap: Map<string, string>;
}

async function processArticle(input: ProcessArticleInput): Promise<{ ok: boolean; title?: string; error?: string }> {
  const { tweetId, tweetUrl, article, author: authorSource, publishedAt, fallbackText, stats, catMap } = input;

  const fullText = article.contents
    ? article.contents.map(c => c.text).join('\n\n')
    : fallbackText;
  const cleanText = stripHtml(fullText);
  const excerpt = article.preview_text || cleanText.slice(0, 300);
  const bodyPreview = cleanText.slice(0, 500);
  const coverImage = article.cover_media_img_url || null;
  const readTime = estimateReadTime(cleanText);

  // Upsert author
  const { data: author } = await supabaseAdmin
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

  if (!author) return { ok: false, error: 'failed to upsert author' };

  // Classify
  const categorySlugs = classifyArticle(article.title, excerpt);

  // Insert article
  const { data: newArticle } = await supabaseAdmin
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

  if (!newArticle) return { ok: false, error: 'failed to insert article' };

  // Link categories
  const categoryLinks = categorySlugs
    .map(slug => catMap.get(slug))
    .filter(Boolean)
    .map(catId => ({ article_id: newArticle.id, category_id: catId! }));

  if (categoryLinks.length > 0) {
    await supabaseAdmin
      .from('article_categories')
      .insert(categoryLinks);
  }

  // Upsert engagement stats (upsert avoids race condition with DB triggers)
  await supabaseAdmin
    .from('article_stats')
    .upsert({
      article_id: newArticle.id,
      like_count: stats.likeCount,
      bookmark_count: stats.bookmarkCount,
      comment_count: stats.replyCount,
      share_count: stats.retweetCount,
    }, { onConflict: 'article_id' });

  return { ok: true, title: article.title };
}

// ─── Category Map Loader ────────────────────────────────────────────

async function loadCategoryMap(): Promise<Map<string, string>> {
  const { data: categories } = await supabaseAdmin
    .from('categories')
    .select('id, slug') as unknown as { data: { id: string; slug: string }[] | null };
  return new Map((categories || []).map(c => [c.slug, c.id]));
}

// ─── Ingestion Logic ─────────────────────────────────────────────────

interface IngestResult {
  accounts_checked: number;
  tweets_scanned: number;
  articles_found: number;
  new_articles: number;
  skipped_duplicates: number;
  skipped_unavailable: number;
  errors: number;
  global_search_articles: number;
  cost_estimate_usd: number;
  duration_ms: number;
}

async function ingestArticleTweet(
  tweet: TimelineTweet,
  handle: string,
  catMap: Map<string, string>,
): Promise<'new' | 'duplicate' | 'error'> {
  if (!tweet.article) return 'error';

  const tweetUrl = tweet.url || `https://x.com/${handle}/status/${tweet.id}`;
  const { data: existing } = await supabaseAdmin
    .from('articles')
    .select('id')
    .or(`x_url.eq.${tweetUrl},x_article_id.eq.${tweet.id}`)
    .maybeSingle();

  if (existing) return 'duplicate';

  const result = await processArticle({
    tweetId: tweet.id,
    tweetUrl,
    article: tweet.article,
    author: tweet.author,
    publishedAt: tweet.createdAt,
    fallbackText: tweet.text,
    stats: {
      likeCount: tweet.likeCount ?? 0,
      bookmarkCount: tweet.bookmarkCount ?? 0,
      replyCount: tweet.replyCount ?? 0,
      retweetCount: tweet.retweetCount ?? 0,
    },
    catMap,
  });

  return result.ok ? 'new' : 'error';
}

async function ingestArticles(): Promise<IngestResult> {
  const start = Date.now();
  let accountsChecked = 0;
  let tweetsScanned = 0;
  let articlesFound = 0;
  let newArticles = 0;
  let skippedDuplicates = 0;
  let skippedUnavailable = 0;
  let errors = 0;
  let globalSearchArticles = 0;

  const catMap = await loadCategoryMap();
  const seedAccounts = await loadSeedAccounts();

  // ── Phase 1: Timeline scan of seed accounts ──
  for (const { handle, highYield } of seedAccounts) {
    try {
      const pages = highYield ? MAX_PAGES_HIGH_YIELD : MAX_PAGES_DEFAULT;
      const tweets = await fetchUserTimeline(handle, pages);
      accountsChecked++;

      if (tweets.length === 0) {
        skippedUnavailable++;
        continue;
      }

      for (const tweet of tweets) {
        tweetsScanned++;
        if (!tweet.article) continue;
        articlesFound++;

        const outcome = await ingestArticleTweet(tweet, handle, catMap);
        if (outcome === 'new') newArticles++;
        else if (outcome === 'duplicate') skippedDuplicates++;
        else errors++;
      }

      await sleep(300);
    } catch (err) {
      console.error(`Error processing @${handle}:`, err);
      errors++;
    }
  }

  // ── Phase 2: Global article search ──
  // Finds articles from accounts NOT in our seed list.
  try {
    const globalTweets = await searchGlobalArticles(GLOBAL_SEARCH_PAGES);
    for (const tweet of globalTweets) {
      tweetsScanned++;
      articlesFound++;

      const handle = tweet.author?.userName || 'unknown';
      const outcome = await ingestArticleTweet(tweet, handle, catMap);
      if (outcome === 'new') {
        newArticles++;
        globalSearchArticles++;
      } else if (outcome === 'duplicate') {
        skippedDuplicates++;
      } else {
        errors++;
      }
    }
  } catch (err) {
    console.error('Global article search error:', err);
  }

  const costEstimate = (accountsChecked + GLOBAL_SEARCH_PAGES) * 0.003;

  return {
    accounts_checked: accountsChecked,
    tweets_scanned: tweetsScanned,
    articles_found: articlesFound,
    new_articles: newArticles,
    skipped_duplicates: skippedDuplicates,
    skipped_unavailable: skippedUnavailable,
    errors,
    global_search_articles: globalSearchArticles,
    cost_estimate_usd: Math.round(costEstimate * 10000) / 10000,
    duration_ms: Date.now() - start,
  };
}

// ─── Single Article Ingestion (by tweet ID) ─────────────────────────

async function ingestSingleArticle(tweetId: string): Promise<{ ok: boolean; title?: string; error?: string }> {
  const catMap = await loadCategoryMap();

  // Dedup check
  const { data: existing } = await supabaseAdmin
    .from('articles')
    .select('id')
    .eq('x_article_id', tweetId)
    .maybeSingle();

  if (existing) return { ok: false, error: 'already exists' };

  // Fetch article via probe endpoint (manual submission doesn't have timeline context)
  const article = await probeArticle(tweetId);
  if (!article) return { ok: false, error: 'not an article or article not found' };

  const tweetUrl = `https://x.com/${article.author.userName}/status/${tweetId}`;

  return processArticle({
    tweetId,
    tweetUrl,
    article,
    author: article.author,
    publishedAt: article.createdAt,
    fallbackText: '',
    stats: {
      likeCount: article.likeCount ?? 0,
      bookmarkCount: 0,
      replyCount: article.replyCount ?? 0,
      retweetCount: 0,
    },
    catMap,
  });
}

// ─── API Route Handlers ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sends this header)
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await ingestArticles();
  console.log('Ingestion complete:', result);

  return NextResponse.json(result);
}

// POST /api/ingest — manually submit article(s) by tweet ID
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const tweetIds: string[] = Array.isArray(body.tweet_ids)
    ? body.tweet_ids
    : body.tweet_id
      ? [body.tweet_id]
      : [];

  if (tweetIds.length === 0) {
    return NextResponse.json({ error: 'provide tweet_id or tweet_ids[]' }, { status: 400 });
  }

  const results = [];
  for (const tid of tweetIds) {
    const result = await ingestSingleArticle(tid);
    results.push({ tweet_id: tid, ...result });
    await sleep(300);
  }

  return NextResponse.json({ ingested: results });
}
