/**
 * Linkdrift RSS Feed Generator
 * 
 * Generates RSS 2.0 + Atom feeds for:
 *   /feed.xml          — latest articles (all categories)
 *   /feed/tech.xml     — single category feed
 *   /feed/featured.xml — featured/editorial picks
 *   /feed/trending.xml — trending this week
 *   /feed/author/[handle].xml — single author feed
 * 
 * Also exposes JSON Feed (jsonfeed.org) at:
 *   /feed.json, /feed/tech.json, etc.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';

// ─── Types ───────────────────────────────────────────────────

interface FeedItem {
  id: string;
  title: string;
  excerpt: string | null;
  x_url: string;
  author_handle: string;
  author_name: string;
  category_slugs: string[];
  published_at: string;
  read_time_min: number | null;
  like_count: number;
  featured: boolean;
}

interface FeedMeta {
  title: string;
  description: string;
  path: string;
}

// ─── Config ──────────────────────────────────────────────────

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://linkdrift.app';
const FEED_LIMIT = 50;
const CACHE_TTL = 900; // 15 min, matches ingestion cycle

// ─── Data Fetchers ───────────────────────────────────────────

async function fetchLatestArticles(limit = FEED_LIMIT): Promise<FeedItem[]> {
  const { data, error } = await supabaseAdmin.rpc('get_feed', {
    p_sort: 'latest',
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data || []).map(normalizeFeedRow);
}

async function fetchCategoryArticles(slug: string, limit = FEED_LIMIT): Promise<FeedItem[]> {
  const { data, error } = await supabaseAdmin.rpc('get_feed', {
    p_category_slug: slug,
    p_sort: 'latest',
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data || []).map(normalizeFeedRow);
}

async function fetchFeaturedArticles(limit = FEED_LIMIT): Promise<FeedItem[]> {
  const { data, error } = await supabaseAdmin
    .from('articles')
    .select(`
      id, title, excerpt, x_url, published_at, read_time_min, featured,
      author:authors(handle, display_name),
      categories:article_categories(category:categories(slug)),
      stats:article_stats(like_count)
    `)
    .eq('status', 'published')
    .eq('featured', true)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data || []).map(normalizeJoinedRow);
}

async function fetchTrendingArticles(limit = FEED_LIMIT): Promise<FeedItem[]> {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('articles')
    .select(`
      id, title, excerpt, x_url, published_at, read_time_min, featured,
      author:authors(handle, display_name),
      categories:article_categories(category:categories(slug)),
      stats:article_stats(like_count)
    `)
    .eq('status', 'published')
    .gte('published_at', since)
    .order('stats(like_count)', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data || []).map(normalizeJoinedRow);
}

async function fetchAuthorArticles(handle: string, limit = FEED_LIMIT): Promise<FeedItem[]> {
  const { data: author } = await supabaseAdmin
    .from('authors')
    .select('id')
    .eq('handle', handle)
    .single();

  if (!author) throw new Error(`Author @${handle} not found`);

  const { data, error } = await supabaseAdmin
    .from('articles')
    .select(`
      id, title, excerpt, x_url, published_at, read_time_min, featured,
      author:authors(handle, display_name),
      categories:article_categories(category:categories(slug)),
      stats:article_stats(like_count)
    `)
    .eq('status', 'published')
    .eq('author_id', author.id)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data || []).map(normalizeJoinedRow);
}

// ─── Normalizers ─────────────────────────────────────────────

function normalizeFeedRow(row: any): FeedItem {
  return {
    id: row.article_id,
    title: row.title,
    excerpt: row.excerpt,
    x_url: row.x_url,
    author_handle: row.author_handle,
    author_name: row.author_name,
    category_slugs: row.category_slugs || [],
    published_at: row.published_at,
    read_time_min: row.read_time_min,
    like_count: row.like_count || 0,
    featured: row.featured,
  };
}

function normalizeJoinedRow(row: any): FeedItem {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    x_url: row.x_url,
    author_handle: row.author?.handle || 'unknown',
    author_name: row.author?.display_name || 'Unknown',
    category_slugs: (row.categories || []).map((ac: any) => ac.category?.slug).filter(Boolean),
    published_at: row.published_at,
    read_time_min: row.read_time_min,
    like_count: row.stats?.like_count || 0,
    featured: row.featured,
  };
}

// ─── RSS 2.0 Generator ──────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function generateRSS(items: FeedItem[], meta: FeedMeta): string {
  const feedUrl = `${SITE_URL}${meta.path}`;
  const buildDate = new Date().toUTCString();

  const itemsXml = items.map(item => {
    const pubDate = item.published_at ? new Date(item.published_at).toUTCString() : buildDate;
    const articleUrl = `${SITE_URL}/article/${item.id}`;
    const categories = item.category_slugs
      .map(s => `    <category>${escapeXml(s)}</category>`)
      .join('\n');

    const description = [
      item.excerpt || '',
      '',
      `By @${item.author_handle}`,
      item.read_time_min ? `${item.read_time_min} min read` : '',
      `Read on X: ${item.x_url}`,
    ].filter(Boolean).join('\n');

    return `  <item>
    <title>${escapeXml(item.title)}</title>
    <link>${escapeXml(item.x_url)}</link>
    <guid isPermaLink="false">${articleUrl}</guid>
    <description>${escapeXml(description)}</description>
    <author>${escapeXml(item.author_handle)}@x.com (${escapeXml(item.author_name)})</author>
    <pubDate>${pubDate}</pubDate>
${categories}
    <source url="${escapeXml(feedUrl)}">Linkdrift</source>
  </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>${escapeXml(meta.title)}</title>
  <link>${SITE_URL}</link>
  <description>${escapeXml(meta.description)}</description>
  <language>en-us</language>
  <lastBuildDate>${buildDate}</lastBuildDate>
  <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
  <image>
    <url>${SITE_URL}/icon.png</url>
    <title>${escapeXml(meta.title)}</title>
    <link>${SITE_URL}</link>
  </image>
  <ttl>15</ttl>
${itemsXml}
</channel>
</rss>`;
}

// ─── Atom Feed Generator ─────────────────────────────────────

export function generateAtom(items: FeedItem[], meta: FeedMeta): string {
  const feedUrl = `${SITE_URL}${meta.path.replace('.xml', '.atom')}`;
  const updated = items[0]?.published_at
    ? new Date(items[0].published_at).toISOString()
    : new Date().toISOString();

  const entriesXml = items.map(item => {
    const published = item.published_at ? new Date(item.published_at).toISOString() : updated;
    const articleUrl = `${SITE_URL}/article/${item.id}`;

    return `  <entry>
    <title>${escapeXml(item.title)}</title>
    <link href="${escapeXml(item.x_url)}" rel="alternate"/>
    <link href="${escapeXml(articleUrl)}" rel="via"/>
    <id>${articleUrl}</id>
    <published>${published}</published>
    <updated>${published}</updated>
    <author><name>${escapeXml(item.author_name)}</name><uri>https://x.com/${escapeXml(item.author_handle)}</uri></author>
    <summary>${escapeXml(item.excerpt || '')}</summary>
${item.category_slugs.map(s => `    <category term="${escapeXml(s)}"/>`).join('\n')}
  </entry>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(meta.title)}</title>
  <link href="${SITE_URL}" rel="alternate"/>
  <link href="${escapeXml(feedUrl)}" rel="self" type="application/atom+xml"/>
  <id>${SITE_URL}/</id>
  <updated>${updated}</updated>
  <subtitle>${escapeXml(meta.description)}</subtitle>
  <generator>Linkdrift</generator>
${entriesXml}
</feed>`;
}

// ─── JSON Feed Generator (jsonfeed.org v1.1) ─────────────────

export function generateJSONFeed(items: FeedItem[], meta: FeedMeta): object {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: meta.title,
    description: meta.description,
    home_page_url: SITE_URL,
    feed_url: `${SITE_URL}${meta.path.replace('.xml', '.json')}`,
    language: 'en-US',
    items: items.map(item => ({
      id: `${SITE_URL}/article/${item.id}`,
      url: item.x_url,
      external_url: item.x_url,
      title: item.title,
      summary: item.excerpt,
      date_published: item.published_at,
      authors: [{
        name: item.author_name,
        url: `https://x.com/${item.author_handle}`,
      }],
      tags: item.category_slugs,
      _byline: {
        read_time_min: item.read_time_min,
        like_count: item.like_count,
        featured: item.featured,
        byline_url: `${SITE_URL}/article/${item.id}`,
      },
    })),
  };
}

// ─── Exports for route handlers ──────────────────────────────

export {
  fetchLatestArticles,
  fetchCategoryArticles,
  fetchFeaturedArticles,
  fetchTrendingArticles,
  fetchAuthorArticles,
  CACHE_TTL,
};
