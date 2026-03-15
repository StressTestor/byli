import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { Article, Author, Category, ArticleStats } from '@/types/database';

// ─── Types ──────────────────────────────────────────────────

interface ArticleRow extends Article {
  author: Author;
  categories: Array<{ category: Category }>;
  stats: ArticleStats;
}

// ─── Data Fetching ──────────────────────────────────────────

async function getArticle(id: string): Promise<ArticleRow | null> {
  const { data, error } = await supabaseAdmin
    .from('articles')
    .select(`
      *,
      author:authors(*),
      categories:article_categories(category:categories(*)),
      stats:article_stats(*)
    `)
    .eq('id', id)
    .eq('status', 'published')
    .single();

  if (error || !data) return null;
  return data as unknown as ArticleRow;
}

async function getRelatedArticles(
  articleId: string,
  authorId: string,
  categoryIds: string[],
  limit = 4
) {
  // try same author first
  const { data: authorArticles } = await supabaseAdmin
    .from('articles')
    .select(`
      id, title, excerpt, x_url, read_time_min, published_at, cover_image_url,
      author:authors(handle, display_name, verified),
      stats:article_stats(like_count, bookmark_count)
    `)
    .eq('author_id', authorId)
    .eq('status', 'published')
    .neq('id', articleId)
    .order('published_at', { ascending: false })
    .limit(limit);

  const results = (authorArticles || []) as any[];

  // if not enough, fill from same categories
  if (results.length < limit && categoryIds.length > 0) {
    const existingIds = [articleId, ...results.map((a: any) => a.id)];
    const { data: catArticles } = await supabaseAdmin
      .from('article_categories')
      .select(`
        article:articles(
          id, title, excerpt, x_url, read_time_min, published_at, cover_image_url,
          author:authors(handle, display_name, verified),
          stats:article_stats(like_count, bookmark_count)
        )
      `)
      .in('category_id', categoryIds)
      .limit(limit * 3);

    const catResults = (catArticles || [])
      .map((row: any) => row.article)
      .filter((a: any) => a && !existingIds.includes(a.id));

    // dedupe
    const seen = new Set(existingIds);
    for (const art of catResults) {
      if (!seen.has(art.id) && results.length < limit) {
        seen.add(art.id);
        results.push(art);
      }
    }
  }

  return results.slice(0, limit);
}

// ─── Helpers ────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(dateStr);
}

// ─── Metadata ───────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const article = await getArticle(id);

  if (!article) {
    return { title: 'Article Not Found' };
  }

  const categories = article.categories?.map((ac) => ac.category) || [];
  const description = article.excerpt || article.body_preview || article.title;
  const url = `https://linkdrift.app/article/${article.id}`;

  return {
    title: article.title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: 'article',
      title: article.title,
      description,
      url,
      siteName: 'Linkdrift',
      locale: 'en_US',
      publishedTime: article.published_at || undefined,
      authors: [article.author.display_name],
      tags: categories.map((c) => c.label),
    },
    twitter: {
      card: 'summary_large_image',
      title: article.title,
      description,
    },
    other: {
      'article:published_time': article.published_at || '',
      'article:author': article.author.display_name,
    },
  };
}

// ─── Page ───────────────────────────────────────────────────

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const article = await getArticle(id);

  if (!article) {
    notFound();
  }

  const categories = article.categories?.map((ac) => ac.category) || [];
  const categoryIds = categories.map((c) => c.id);
  const relatedArticles = await getRelatedArticles(
    article.id,
    article.author_id,
    categoryIds
  );

  const stats = article.stats || {
    like_count: 0,
    bookmark_count: 0,
    comment_count: 0,
    share_count: 0,
  };

  // JSON-LD NewsArticle schema
  // Safe: all values come from the database and JSON.stringify escapes them
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.excerpt || article.body_preview || '',
    url: `https://linkdrift.app/article/${article.id}`,
    datePublished: article.published_at,
    dateModified: article.updated_at,
    author: {
      '@type': 'Person',
      name: article.author.display_name,
      url: `https://x.com/${article.author.handle}`,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Linkdrift',
      url: 'https://linkdrift.app',
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `https://linkdrift.app/article/${article.id}`,
    },
    ...(article.cover_image_url && { image: article.cover_image_url }),
    ...(categories.length > 0 && {
      articleSection: categories.map((c) => c.label).join(', '),
    }),
    interactionStatistic: [
      {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/LikeAction',
        userInteractionCount: stats.like_count,
      },
      {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/BookmarkAction',
        userInteractionCount: stats.bookmark_count,
      },
      {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/CommentAction',
        userInteractionCount: stats.comment_count,
      },
    ],
  };
  const jsonLdHtml = JSON.stringify(jsonLd);

  return (
    <div className="min-h-screen bg-zinc-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml }}
      />

      {/* Header */}
      <header className="border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link
            href="/"
            className="text-xl font-bold tracking-tight text-white hover:text-zinc-300 transition-colors"
          >
            linkdrift
          </Link>
          <span className="text-xs text-zinc-600 hidden sm:inline">
            where X Articles surface
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Cover image */}
        {article.cover_image_url && (
          <div className="mb-8 rounded-xl overflow-hidden border border-zinc-800/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={article.cover_image_url}
              alt={article.title}
              className="w-full h-auto max-h-96 object-cover"
            />
          </div>
        )}

        {/* Categories */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={`/category/${cat.slug}`}
                className="text-xs px-2.5 py-1 rounded-full bg-zinc-800/60 text-zinc-400 hover:text-white hover:bg-zinc-700/60 transition-colors"
              >
                {cat.icon && <span className="mr-1">{cat.icon}</span>}
                {cat.label}
              </Link>
            ))}
          </div>
        )}

        {/* Title */}
        <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight mb-6">
          {article.title}
        </h1>

        {/* Author info */}
        <div className="flex items-center gap-3 mb-6">
          <Link href={`/author/${article.author.handle}`} className="flex-shrink-0">
            {article.author.avatar_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={article.author.avatar_url}
                alt={article.author.display_name}
                className="w-11 h-11 rounded-full object-cover border border-zinc-700"
              />
            ) : (
              <div className="w-11 h-11 rounded-full bg-zinc-700 flex items-center justify-center text-sm font-medium text-white uppercase">
                {article.author.display_name[0] || '?'}
              </div>
            )}
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Link
                href={`/author/${article.author.handle}`}
                className="text-sm font-semibold text-white hover:text-zinc-300 transition-colors truncate"
              >
                {article.author.display_name}
              </Link>
              {article.author.verified && (
                <svg
                  width="16"
                  height="16"
                  className="w-4 h-4 text-blue-400 flex-shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Link
                href={`/author/${article.author.handle}`}
                className="hover:text-zinc-400 transition-colors"
              >
                @{article.author.handle}
              </Link>
              {article.author.follower_count > 0 && (
                <>
                  <span className="text-zinc-700">·</span>
                  <span>{formatNumber(article.author.follower_count)} followers</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Meta row: date, read time */}
        <div className="flex items-center gap-3 text-sm text-zinc-500 mb-6 pb-6 border-b border-zinc-800/60">
          {article.published_at && (
            <time dateTime={article.published_at}>
              {formatDate(article.published_at)}
            </time>
          )}
          {article.read_time_min && (
            <>
              <span className="text-zinc-700">·</span>
              <span>{article.read_time_min} min read</span>
            </>
          )}
          {article.featured && (
            <>
              <span className="text-zinc-700">·</span>
              <span className="flex items-center gap-1 text-amber-400/80 text-xs font-medium uppercase tracking-wider">
                <svg
                  width="12"
                  height="12"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                Featured
              </span>
            </>
          )}
        </div>

        {/* Excerpt / body preview */}
        {(article.excerpt || article.body_preview) && (
          <div className="mb-8">
            {article.excerpt && (
              <p className="text-lg text-zinc-300 leading-relaxed mb-4">
                {article.excerpt}
              </p>
            )}
            {article.body_preview && article.body_preview !== article.excerpt && (
              <p className="text-sm text-zinc-400 leading-relaxed whitespace-pre-line">
                {article.body_preview}
              </p>
            )}
          </div>
        )}

        {/* Engagement stats bar */}
        <div className="flex items-center gap-6 py-4 px-5 rounded-xl border border-zinc-800/60 bg-zinc-900/30 mb-8">
          <StatItem
            icon={
              <svg
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
                />
              </svg>
            }
            count={stats.like_count}
            label="Likes"
          />
          <StatItem
            icon={
              <svg
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
                />
              </svg>
            }
            count={stats.bookmark_count}
            label="Bookmarks"
          />
          <StatItem
            icon={
              <svg
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z"
                />
              </svg>
            }
            count={stats.comment_count}
            label="Comments"
          />
          <StatItem
            icon={
              <svg
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z"
                />
              </svg>
            }
            count={stats.share_count}
            label="Shares"
          />
        </div>

        {/* Read full article CTA */}
        <a
          href={article.x_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl bg-white text-zinc-950 font-semibold text-sm hover:bg-zinc-200 transition-colors mb-12"
        >
          Read full article on X
          <svg
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25"
            />
          </svg>
        </a>

        {/* Related articles */}
        {relatedArticles.length > 0 && (
          <section className="border-t border-zinc-800/60 pt-8">
            <h2 className="text-lg font-semibold text-white mb-5">
              more from{' '}
              <Link
                href={`/author/${article.author.handle}`}
                className="text-zinc-400 hover:text-white transition-colors"
              >
                @{article.author.handle}
              </Link>
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {relatedArticles.map((related: any) => (
                <Link
                  key={related.id}
                  href={`/article/${related.id}`}
                  className="group border border-zinc-800/60 rounded-xl p-4 hover:border-zinc-600 hover:bg-zinc-900/30 transition-all duration-200"
                >
                  {related.cover_image_url && (
                    <div className="mb-3 rounded-lg overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={related.cover_image_url}
                        alt={related.title}
                        className="w-full h-32 object-cover"
                      />
                    </div>
                  )}
                  <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-white leading-snug line-clamp-2 mb-2">
                    {related.title}
                  </h3>
                  {related.excerpt && (
                    <p className="text-xs text-zinc-500 line-clamp-2 mb-2">
                      {related.excerpt}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-zinc-600">
                    <span className="text-zinc-400">
                      @{related.author?.handle || article.author.handle}
                    </span>
                    {related.author?.verified && (
                      <svg
                        width="12"
                        height="12"
                        className="text-blue-400"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                    {related.read_time_min && (
                      <>
                        <span className="text-zinc-700">·</span>
                        <span>{related.read_time_min} min</span>
                      </>
                    )}
                    {related.published_at && (
                      <>
                        <span className="text-zinc-700">·</span>
                        <span>{timeAgo(related.published_at)}</span>
                      </>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-zinc-800 text-xs text-zinc-600 flex gap-4">
          <Link href="/" className="hover:text-zinc-400">
            Home
          </Link>
          <Link href="/about" className="hover:text-zinc-400">
            About
          </Link>
          <Link href="/privacy" className="hover:text-zinc-400">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-zinc-400">
            Terms
          </Link>
        </div>
      </main>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────

function StatItem({
  icon,
  count,
  label,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 text-zinc-500">
      <span className="flex-shrink-0">{icon}</span>
      <div className="flex flex-col">
        <span className="text-sm font-medium text-zinc-300">
          {formatNumber(count)}
        </span>
        <span className="text-[11px] text-zinc-600 hidden sm:block">{label}</span>
      </div>
    </div>
  );
}
