/**
 * Linkdrift Ingestion Worker
 *
 * Discovery strategy: fetch timelines from curated accounts, then probe
 * each tweet against the /twitter/article endpoint. X Articles are regular
 * tweets with article content attached - there's no search filter for them,
 * so we try each tweet and keep the ones that return article data.
 *
 * Cron config in vercel.json:
 * { "crons": [{ "path": "/api/ingest", "schedule": "0 0 * * *" }] }
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { NextResponse, NextRequest } from 'next/server';

// ─── Config ──────────────────────────────────────────────────────────

const TWITTERAPI_KEY = process.env.TWITTERAPI_IO_KEY!;
const TWITTERAPI_BASE = 'https://api.twitterapi.io/twitter';
const ARTICLE_FETCH_DELAY = 250; // ms between article probes

// Curated accounts known to post X Articles.
// Add more handles here to expand coverage.
const SEED_ACCOUNTS = [
  'elonmusk', 'pmarca', 'paulg', 'naval', 'balaborafael',
  'VitalikButerin', 'sama', 'garaborafael', 'chaaborafael',
  'Snowden', 'jack', 'mattxwebb', 'benthompson',
  'cdixon', 'patrickc', 'levelsio', 'DHH',
  'jason', 'saborafael', 'BillGates', 'sataborafael',
  'Grimezsz', 'MarioNawfal', 'cb_doge', 'WallStreetSilv',
  'unusual_whales', 'Farzad_Mesbahi',
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
  tweetBy: {
    id: string;
    userName: string;
    name: string;
    profilePicture: string;
    isBlueVerified: boolean;
    followers: number;
  };
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  bookmarkCount: number;
  quoteCount: number;
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
  const res = await fetch(`${TWITTERAPI_BASE}/user/tweets?${params}`, {
    headers: { 'X-API-Key': TWITTERAPI_KEY },
  });

  if (!res.ok) return [];

  const json: UserTimelineResponse = await res.json();
  // API returns tweets in different shapes
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
  let articleProbes = 0;

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

        // Skip retweets - they won't be articles by this user
        if (tweet.type === 'Retweet' || tweet.text?.startsWith('RT @')) continue;

        // Dedup check first (cheap, no API call)
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

        // Probe the article endpoint
        await sleep(ARTICLE_FETCH_DELAY);
        articleProbes++;
        const article = await probeArticle(tweet.id);
        if (!article) continue;

        // Found an article
        articlesFound++;

        const fullText = article.contents
          ? article.contents.map(c => c.text).join('\n\n')
          : tweet.text;
        const cleanText = stripHtml(fullText);
        const excerpt = article.preview_text || cleanText.slice(0, 300);
        const bodyPreview = cleanText.slice(0, 500);
        const coverImage = article.cover_media_img_url || null;
        const readTime = estimateReadTime(cleanText);

        // Resolve author from article data
        const authorSource = article.author || tweet.tweetBy;

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
            published_at: article.createdAt || tweet.createdAt,
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

        // Seed engagement stats from article metrics
        await supabaseAdmin
          .from('article_stats')
          .update({
            like_count: article.likeCount ?? tweet.likeCount ?? 0,
            bookmark_count: tweet.bookmarkCount ?? 0,
            comment_count: article.replyCount ?? tweet.replyCount ?? 0,
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

  // Cost estimate: timeline = ~$0.003/page, article probe = 100 credits each
  const timelinePages = accountsChecked;
  const costEstimate = (timelinePages * 0.003) + (articleProbes * 0.015);

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

// ─── API Route Handler ──────────────────────────────────────────────

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
