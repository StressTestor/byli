/**
 * Byline Ingestion Worker
 * 
 * Two-phase pipeline using TwitterAPI.io:
 *   1. DISCOVER — advanced_search to find tweets linking to X Articles
 *   2. ENRICH  — /twitter/article endpoint for full article content
 * 
 * Run as: Vercel Cron (every 15 min) or standalone Node script.
 * 
 * Cron config in vercel.json:
 * { "crons": [{ "path": "/api/ingest", "schedule": "0 0 * * *" }] }
 * 
 * Cost estimate (TwitterAPI.io pay-as-you-go):
 *   Search:  $0.15 / 1K tweets  = ~$0.003 per page (20 results)
 *   Article: 100 credits each    = ~$0.015 per article
 *   Per cycle (20 new articles): ~$0.003 + $0.30 = ~$0.30
 *   Per day (96 cycles, ~10 new avg): ~$15/day worst case
 *   Reality: Most cycles find 0-5 new → ~$2-5/day
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { NextResponse, NextRequest } from 'next/server';

// ─── Config ──────────────────────────────────────────────────────────

const TWITTERAPI_KEY = process.env.TWITTERAPI_IO_KEY!;
const TWITTERAPI_BASE = 'https://api.twitterapi.io/twitter';
const MAX_PAGES = 3;          // max pagination depth per cycle
const ARTICLE_FETCH_DELAY = 200; // ms between article fetches (rate limiting)

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

interface TwitterApiTweet {
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
  entities?: {
    urls?: Array<{
      expanded_url: string;
      display_url: string;
    }>;
  };
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  bookmarkCount: number;
  quoteCount: number;
}

interface TwitterApiSearchResponse {
  tweets: TwitterApiTweet[];
  has_next_page: boolean;
  next_cursor?: string;
}

interface TwitterApiArticleResponse {
  status: string;
  article: {
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
      followers: number;
    };
    createdAt: string;
    likeCount: number;
    replyCount: number;
    quoteCount: number;
    viewCount: number;
  };
}

// ─── Phase 1: DISCOVER ───────────────────────────────────────────────
//
// Uses advanced_search to find tweets containing article URLs.
// X Articles follow the pattern: x.com/{username}/articles/{id}
//
// We use X's search operators via the query parameter.
// The igorbrigadir/twitter-advanced-search reference documents
// available operators like url:, since:, min_faves:, etc.

async function discoverArticleTweets(cursor?: string): Promise<TwitterApiSearchResponse> {
  // Search for tweets sharing article URLs
  // The url: operator matches expanded URLs in tweet entities
  const query = 'url:"x.com" url:"articles"';

  const params = new URLSearchParams({
    query,
    queryType: 'Latest',
    ...(cursor && { cursor }),
  });

  const res = await fetch(`${TWITTERAPI_BASE}/tweet/advanced_search?${params}`, {
    headers: { 'X-API-Key': TWITTERAPI_KEY },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TwitterAPI.io search error: ${res.status} ${body}`);
  }

  return res.json();
}

// ─── Phase 2: ENRICH ─────────────────────────────────────────────────
//
// Fetches full article content by tweet ID.
// Endpoint: GET /twitter/article?id={tweetId}
// Cost: 100 credits (~$0.015) per article.

async function fetchArticleContent(tweetId: string): Promise<TwitterApiArticleResponse['article'] | null> {
  const params = new URLSearchParams({ tweet_id: tweetId });

  const res = await fetch(`${TWITTERAPI_BASE}/article?${params}`, {
    headers: { 'X-API-Key': TWITTERAPI_KEY },
  });

  if (!res.ok) {
    // 404/400 = not actually an article tweet, skip gracefully
    if (res.status === 404 || res.status === 400) return null;
    const body = await res.text();
    throw new Error(`TwitterAPI.io article error: ${res.status} ${body}`);
  }

  const json: TwitterApiArticleResponse = await res.json();
  if (json.status !== 'success' || !json.article) return null;
  return json.article;
}

// ─── URL Pattern Detection ───────────────────────────────────────────

const ARTICLE_URL_PATTERN = /(?:x|twitter)\.com\/([a-zA-Z0-9_]+)\/articles\/(\d+)/;

function extractArticleInfo(tweet: TwitterApiTweet): { url: string; handle: string; articleId: string } | null {
  // Check tweet URL directly
  const directMatch = (tweet.url || '').match(ARTICLE_URL_PATTERN);
  if (directMatch) {
    return { url: tweet.url, handle: directMatch[1], articleId: directMatch[2] };
  }

  // Check entity URLs (expanded URLs from t.co shortlinks)
  if (tweet.entities?.urls) {
    for (const u of tweet.entities.urls) {
      const expanded = u.expanded_url || u.display_url || '';
      const match = expanded.match(ARTICLE_URL_PATTERN);
      if (match) {
        return { url: expanded, handle: match[1], articleId: match[2] };
      }
    }
  }

  // Check raw tweet text
  const textMatch = (tweet.text || '').match(ARTICLE_URL_PATTERN);
  if (textMatch) {
    return {
      url: `https://x.com/${textMatch[1]}/articles/${textMatch[2]}`,
      handle: textMatch[1],
      articleId: textMatch[2],
    };
  }

  return null;
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
  searched: number;
  articles_found: number;
  articles_enriched: number;
  new_articles: number;
  skipped_duplicates: number;
  skipped_not_article: number;
  errors: number;
  cost_estimate_usd: number;
  duration_ms: number;
}

async function ingestArticles(): Promise<IngestResult> {
  const start = Date.now();
  let searched = 0;
  let articlesFound = 0;
  let articlesEnriched = 0;
  let newArticles = 0;
  let skipped = 0;
  let skippedNotArticle = 0;
  let errors = 0;

  // Load category slugs -> IDs map
  const { data: categories } = await supabaseAdmin
    .from('categories')
    .select('id, slug') as unknown as { data: { id: string; slug: string }[] | null };
  const catMap = new Map((categories || []).map(c => [c.slug, c.id]));

  let cursor: string | undefined;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      // Phase 1: DISCOVER
      const searchResult = await discoverArticleTweets(cursor);
      const tweets = searchResult.tweets || [];
      searched += tweets.length;

      if (tweets.length === 0) break;

      for (const tweet of tweets) {
        try {
          // Extract article URL from tweet
          const articleInfo = extractArticleInfo(tweet);
          if (!articleInfo) {
            skippedNotArticle++;
            continue;
          }

          articlesFound++;

          // Dedup check: by URL or by tweet ID
          const { data: existing } = await supabaseAdmin
            .from('articles')
            .select('id')
            .or(`x_url.eq.${articleInfo.url},x_article_id.eq.${tweet.id}`)
            .maybeSingle();

          if (existing) {
            skipped++;
            continue;
          }

          // Phase 2: ENRICH — fetch full article content
          await sleep(ARTICLE_FETCH_DELAY);
          const enriched = await fetchArticleContent(tweet.id);
          articlesEnriched++;

          // Build article data from enriched content or tweet fallback
          const title = enriched?.title || tweet.text.slice(0, 120) || 'Untitled';
          const fullText = enriched?.contents
            ? enriched.contents.map(c => c.text).join('\n\n')
            : tweet.text;
          const cleanText = stripHtml(fullText);
          const excerpt = enriched?.preview_text || cleanText.slice(0, 300);
          const bodyPreview = cleanText.slice(0, 500);
          const coverImage = enriched?.cover_media_img_url || null;
          const readTime = estimateReadTime(cleanText);

          // Resolve author (enriched takes priority)
          const authorSource = enriched?.author || tweet.tweetBy;

          // Upsert author
          const { data: author } = await supabaseAdmin
            .from('authors')
            .upsert({
              x_user_id: authorSource.id,
              handle: authorSource.userName,
              display_name: authorSource.name,
              avatar_url: authorSource.profilePicture,
              verified: authorSource.isBlueVerified || false,
              follower_count: authorSource.followers || 0,
            }, { onConflict: 'x_user_id' })
            .select('id')
            .single();

          if (!author) {
            errors++;
            continue;
          }

          // Classify
          const categorySlugs = classifyArticle(title, excerpt);

          // Insert article
          const { data: newArticle } = await supabaseAdmin
            .from('articles')
            .insert({
              x_article_id: tweet.id,
              x_url: articleInfo.url,
              title,
              excerpt,
              body_preview: bodyPreview,
              author_id: author.id,
              cover_image_url: coverImage,
              read_time_min: readTime,
              status: 'published',
              source: 'twitterapi',
              published_at: enriched?.createdAt || tweet.createdAt,
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

          // Seed engagement stats from X metrics
          await supabaseAdmin
            .from('article_stats')
            .update({
              like_count: enriched?.likeCount ?? tweet.likeCount ?? 0,
              bookmark_count: tweet.bookmarkCount ?? 0,
              comment_count: enriched?.replyCount ?? tweet.replyCount ?? 0,
              share_count: tweet.retweetCount ?? 0,
            })
            .eq('article_id', newArticle.id);

          newArticles++;
        } catch (err) {
          console.error(`Error processing tweet ${tweet.id}:`, err);
          errors++;
        }
      }

      // Paginate or stop
      if (!searchResult.has_next_page || !searchResult.next_cursor) break;
      cursor = searchResult.next_cursor;
      await sleep(500); // brief pause between pages
    }
  } catch (err) {
    console.error('Ingestion batch failed:', err);
    errors++;
  }

  // Cost estimate
  const searchPages = Math.ceil(searched / 20);
  const costEstimate = (searchPages * 0.003) + (articlesEnriched * 0.015);

  return {
    searched,
    articles_found: articlesFound,
    articles_enriched: articlesEnriched,
    new_articles: newArticles,
    skipped_duplicates: skipped,
    skipped_not_article: skippedNotArticle,
    errors,
    cost_estimate_usd: Math.round(costEstimate * 10000) / 10000,
    duration_ms: Date.now() - start,
  };
}

// ─── API Route Handler (for Vercel Cron) ─────────────────────────────

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
