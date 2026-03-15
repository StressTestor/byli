/**
 * Linkdrift Ingestion Worker
 *
 * Discovery strategy: fetch timelines from curated accounts.
 * The timeline response includes an `article` field on each tweet —
 * non-null means it's an X Article with title, preview, cover image inline.
 * No extra API calls needed for discovery.
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

// Accounts confirmed to post X Articles (article field != null).
// High-yield accounts are paginated deeper (up to MAX_PAGES).
const SEED_ACCOUNTS = [
  // Confirmed article writers (tested 2026-03-05)
  'Decentralisedco',  // 8/20 tweets are articles — primary source
  'NotBatmanDev',
  'DefiIgnas',
  'CryptoCred',
  'Rewkang',
  'tokenterminal',
  // High-profile accounts — low article rate but worth checking
  'elonmusk', 'pmarca', 'paulg', 'naval',
  'VitalikButerin', 'sama', 'balajis',
  'Snowden', 'jack', 'benthompson',
  'cdixon', 'patrickc', 'levelsio', 'DHH',
  'jason', 'BillGates', 'TimCook',
  'MarioNawfal', 'cb_doge', 'WallStreetSilv',
  'unusual_whales', 'garrytan', 'Suhail',
  'mattxwebb', 'nntaleb',
  'tylercowen', 'matthewball', 'wolfejosh',
];

// Paginate deeper for high-yield accounts
const HIGH_YIELD_ACCOUNTS = new Set(['Decentralisedco']);
const MAX_PAGES = 3; // ~60 tweets per high-yield account

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

// ─── Shared Article Processing ──────────────────────────────────────
//
//  Both cron (GET) and manual (POST) paths converge here.
//
//  ┌─────────────┐     ┌──────────────┐
//  │ timeline    │     │ probeArticle │
//  │ tweet.article│    │ /article?id  │
//  └──────┬──────┘     └──────┬───────┘
//         │ normalize          │
//         ▼                   ▼
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
  cost_estimate_usd: number;
  duration_ms: number;
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

  const catMap = await loadCategoryMap();

  for (const handle of SEED_ACCOUNTS) {
    try {
      const pages = HIGH_YIELD_ACCOUNTS.has(handle) ? MAX_PAGES : 1;
      const tweets = await fetchUserTimeline(handle, pages);
      accountsChecked++;

      if (tweets.length === 0) {
        skippedUnavailable++;
        continue;
      }

      for (const tweet of tweets) {
        tweetsScanned++;

        // Skip non-articles immediately — the timeline includes the article
        // field inline. No extra API call needed.
        if (!tweet.article) continue;

        articlesFound++;

        // Dedup check
        const tweetUrl = tweet.url || `https://x.com/${handle}/status/${tweet.id}`;
        const { data: existing } = await supabaseAdmin
          .from('articles')
          .select('id')
          .or(`x_url.eq.${tweetUrl},x_article_id.eq.${tweet.id}`)
          .maybeSingle();

        if (existing) {
          skippedDuplicates++;
          continue;
        }

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

        if (result.ok) {
          newArticles++;
        } else {
          errors++;
        }
      }

      await sleep(300); // brief pause between accounts
    } catch (err) {
      console.error(`Error processing @${handle}:`, err);
      errors++;
    }
  }

  // Cost: only timeline fetches, no article probes needed
  const costEstimate = accountsChecked * 0.003;

  return {
    accounts_checked: accountsChecked,
    tweets_scanned: tweetsScanned,
    articles_found: articlesFound,
    new_articles: newArticles,
    skipped_duplicates: skippedDuplicates,
    skipped_unavailable: skippedUnavailable,
    errors,
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
