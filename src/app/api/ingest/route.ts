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

// ─── Config ──────────────────────────────────────────────────────────

const TWITTERAPI_KEY = process.env.TWITTERAPI_IO_KEY!;
const TWITTERAPI_BASE = 'https://api.twitterapi.io/twitter';

// Curated accounts known to post X Articles.
// Add more handles here to expand coverage.
const SEED_ACCOUNTS = [
  'elonmusk', 'pmarca', 'paulg', 'naval',
  'VitalikButerin', 'sama', 'balajis',
  'Snowden', 'jack', 'benthompson',
  'cdixon', 'patrickc', 'levelsio', 'DHH',
  'jason', 'BillGates', 'TimCook',
  'MarioNawfal', 'cb_doge', 'WallStreetSilv',
  'unusual_whales', 'garrytan', 'Suhail',
  'Decentralisedco', 'mattxwebb', 'nntaleb',
  'tylercowen', 'matthewball', 'wolfejosh',
];

// ─── Category Classifier (v1: keyword matching) ─────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  tech: ['ai', 'artificial intelligence', 'machine learning', 'software', 'programming', 'developer', 'code', 'startup', 'saas', 'cloud', 'cybersecurity', 'blockchain', 'crypto', 'gpu', 'data', 'algorithm', 'neural', 'api', 'open source', 'llm', 'model', 'compute'],
  politics: ['election', 'congress', 'senate', 'democracy', 'policy', 'government', 'regulation', 'legislation', 'political', 'vote', 'campaign', 'partisan', 'liberal', 'conservative', 'law', 'supreme court', 'president', 'governor'],
  science: ['research', 'study', 'scientist', 'biology', 'physics', 'chemistry', 'climate', 'space', 'nasa', 'genome', 'crispr', 'evolution', 'quantum', 'experiment', 'peer-reviewed', 'nature', 'mars', 'ocean'],
  business: ['market', 'startup', 'revenue', 'funding', 'investor', 'vc', 'venture', 'ipo', 'stock', 'economy', 'gdp', 'inflation', 'recession', 'profit', 'acquisition', 'merger', 'earnings', 'retail', 'finance'],
  culture: ['film', 'movie', 'music', 'art', 'book', 'entertainment', 'streaming', 'cultural', 'fashion', 'design', 'creative', 'media', 'pop', 'series', 'album', 'exhibition', 'literary', 'theater'],
  sports: ['game', 'player', 'team', 'championship', 'league', 'coach', 'nba', 'nfl', 'mlb', 'soccer', 'football', 'basketball', 'tennis', 'olympic', 'match', 'tournament', 'season', 'score'],
  opinion: ['opinion', 'editorial', 'commentary', 'perspective', 'take', 'argument', 'debate', 'disagree', 'believe', 'think', 'should', 'must', 'ought'],
};

function classifyArticle(title: string, excerpt: string): string[] {
  const text = `${title} ${excerpt}`.toLowerCase();
  const scores: Record<string, number> = {};

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[category] = keywords.reduce((score, kw) => {
      const regex = new RegExp(`\\b${kw}\\b`, 'gi');
      const matches = text.match(regex);
      return score + (matches?.length || 0);
    }, 0);
  }

  return Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([cat]) => cat);
}

// ─── TwitterAPI.io Types ─────────────────────────────────────────────

interface TimelineTweet {
  id: string;
  text: string;
  type: string;
  createdAt: string;
  url: string;
  author: {
    id: string;
    userName: string;
    name: string;
    profilePicture: string;
    isBlueVerified: boolean;
    isVerified?: boolean;
    followers: number;
  };
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  bookmarkCount: number;
  quoteCount: number;
  viewCount: number | string;
  // Non-null when tweet is an X Article
  article: {
    title: string;
    preview_text: string;
    cover_media_img_url?: string;
    contents: Array<{ text: string }>;
  } | null;
}

interface UserTimelineResponse {
  status: string;
  data?: {
    tweets?: TimelineTweet[];
    unavailable?: boolean;
  };
  tweets?: TimelineTweet[];
}

interface ArticleData {
  title: string;
  preview_text: string;
  cover_media_img_url?: string;
  contents: Array<{ text: string }>;
  author: {
    id: string;
    userName: string;
    name: string;
    profilePicture: string;
    isBlueVerified: boolean;
    isVerified?: boolean;
    followers: number;
  };
  createdAt: string;
  likeCount: number;
  replyCount: number;
  quoteCount: number;
  viewCount: number | string;
}

// ─── API Helpers ─────────────────────────────────────────────────────

async function fetchUserTimeline(userName: string): Promise<TimelineTweet[]> {
  const params = new URLSearchParams({ userName });
  const res = await fetch(`${TWITTERAPI_BASE}/user/last_tweets?${params}`, {
    headers: { 'X-API-Key': TWITTERAPI_KEY },
  });

  if (!res.ok) return [];

  const json: UserTimelineResponse = await res.json();
  // API returns tweets in .data.tweets
  const tweets = json.data?.tweets || json.tweets || [];
  if (json.data?.unavailable) return [];
  return Array.isArray(tweets) ? tweets : [];
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

// ─── Text Processing ─────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function estimateReadTime(text: string): number {
  const wordCount = text.split(/\s+/).length;
  return Math.max(Math.ceil(wordCount / 250), 2);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

  // Load category slugs -> IDs map
  const { data: categories } = await supabaseAdmin
    .from('categories')
    .select('id, slug') as unknown as { data: { id: string; slug: string }[] | null };
  const catMap = new Map((categories || []).map(c => [c.slug, c.id]));

  for (const handle of SEED_ACCOUNTS) {
    try {
      const tweets = await fetchUserTimeline(handle);
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

        const article = tweet.article;
        const fullText = article.contents
          ? article.contents.map(c => c.text).join('\n\n')
          : tweet.text;
        const cleanText = stripHtml(fullText);
        const excerpt = article.preview_text || cleanText.slice(0, 300);
        const bodyPreview = cleanText.slice(0, 500);
        const coverImage = article.cover_media_img_url || null;
        const readTime = estimateReadTime(cleanText);

        const authorSource = tweet.author;

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

        if (!author) {
          errors++;
          continue;
        }

        // Classify
        const categorySlugs = classifyArticle(article.title, excerpt);

        // Insert article
        const { data: newArticle } = await supabaseAdmin
          .from('articles')
          .insert({
            x_article_id: tweet.id,
            x_url: tweetUrl,
            title: article.title || 'Untitled',
            excerpt,
            body_preview: bodyPreview,
            author_id: author.id,
            cover_image_url: coverImage,
            read_time_min: readTime,
            status: 'published',
            source: 'twitterapi',
            published_at: tweet.createdAt,
          })
          .select('id')
          .single();

        if (!newArticle) {
          errors++;
          continue;
        }

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

        // Seed engagement stats from tweet metrics
        await supabaseAdmin
          .from('article_stats')
          .update({
            like_count: tweet.likeCount ?? 0,
            bookmark_count: tweet.bookmarkCount ?? 0,
            comment_count: tweet.replyCount ?? 0,
            share_count: tweet.retweetCount ?? 0,
          })
          .eq('article_id', newArticle.id);

        newArticles++;
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
  // Load categories
  const { data: categories } = await supabaseAdmin
    .from('categories')
    .select('id, slug') as unknown as { data: { id: string; slug: string }[] | null };
  const catMap = new Map((categories || []).map(c => [c.slug, c.id]));

  // Dedup check
  const { data: existing } = await supabaseAdmin
    .from('articles')
    .select('id')
    .eq('x_article_id', tweetId)
    .maybeSingle();

  if (existing) return { ok: false, error: 'already exists' };

  // Fetch article
  const article = await probeArticle(tweetId);
  if (!article) return { ok: false, error: 'not an article or article not found' };

  const fullText = article.contents
    ? article.contents.map(c => c.text).join('\n\n')
    : '';
  const cleanText = stripHtml(fullText);
  const excerpt = article.preview_text || cleanText.slice(0, 300);
  const bodyPreview = cleanText.slice(0, 500);
  const coverImage = article.cover_media_img_url || null;
  const readTime = estimateReadTime(cleanText);
  const authorSource = article.author;
  const tweetUrl = `https://x.com/${authorSource.userName}/status/${tweetId}`;

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

  const categorySlugs = classifyArticle(article.title, excerpt);

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
      published_at: article.createdAt,
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

  // Seed stats
  await supabaseAdmin
    .from('article_stats')
    .update({
      like_count: article.likeCount ?? 0,
      bookmark_count: 0,
      comment_count: article.replyCount ?? 0,
      share_count: 0,
    })
    .eq('article_id', newArticle.id);

  return { ok: true, title: article.title };
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
