/**
 * Category Page
 *
 * Server component. Fetches category by slug, lists all published articles
 * in that category with author info, engagement stats, and read times.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase-admin';

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ─── Metadata ────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  const { data } = await supabaseAdmin
    .from('categories')
    .select('label, slug')
    .eq('slug', slug)
    .single();

  const category = data as any;

  if (!category) {
    return { title: 'Category Not Found' };
  }

  return {
    title: `${category.label} Articles - Linkdrift`,
    description: `Browse ${category.label} articles on Linkdrift. Long-form content from X, curated and categorized.`,
    openGraph: {
      title: `${category.label} Articles - Linkdrift`,
      description: `Browse ${category.label} articles on Linkdrift. Long-form content from X, curated and categorized.`,
    },
    twitter: {
      card: 'summary',
      title: `${category.label} Articles - Linkdrift`,
      description: `Browse ${category.label} articles on Linkdrift.`,
    },
  };
}

// ─── Page ────────────────────────────────────────────────────────────

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // fetch category
  const { data: categoryData } = await supabaseAdmin
    .from('categories')
    .select('*')
    .eq('slug', slug)
    .single();

  const category = categoryData as any;
  if (!category) notFound();

  // fetch article IDs in this category
  const { data: articleCategoryRows } = (await supabaseAdmin
    .from('article_categories')
    .select('article_id')
    .eq('category_id', category.id)) as { data: any[] | null };

  const articleIds = (articleCategoryRows ?? []).map((row: any) => row.article_id);

  // fetch articles with author + stats
  let articleList: any[] = [];

  if (articleIds.length > 0) {
    const { data: articles } = (await supabaseAdmin
      .from('articles')
      .select(`
        id,
        title,
        excerpt,
        x_url,
        read_time_min,
        published_at,
        featured,
        authors ( id, handle, display_name, avatar_url, verified ),
        article_stats ( like_count, bookmark_count, comment_count, share_count ),
        article_categories ( categories ( slug, label ) )
      `)
      .in('id', articleIds)
      .eq('status', 'published')
      .order('published_at', { ascending: false })) as { data: any[] | null };

    articleList = articles ?? [];
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header bar */}
      <header className="border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center">
          <Link href="/" className="text-xl font-bold tracking-tight text-white">
            linkdrift
          </Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 pt-10 pb-16">
        {/* Category header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            {category.label}
          </h1>
          <p className="text-sm text-zinc-500">
            {articleList.length} article{articleList.length === 1 ? '' : 's'}
          </p>
        </div>

        {/* Articles */}
        {articleList.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📭</div>
            <h3 className="text-lg font-medium text-zinc-300 mb-1">No articles yet</h3>
            <p className="text-sm text-zinc-500">No articles in this category. Check back soon.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {articleList.map((article: any) => {
              const author = Array.isArray(article.authors)
                ? article.authors[0]
                : article.authors;
              const stats = Array.isArray(article.article_stats)
                ? article.article_stats[0]
                : article.article_stats;
              const categories = (article.article_categories ?? [])
                .map((ac: any) => ac.categories)
                .filter(Boolean);

              return (
                <Link
                  key={article.id}
                  href={`/article/${article.id}`}
                  className="group block border border-zinc-800/60 rounded-xl p-5 hover:border-zinc-600 hover:bg-zinc-900/30 transition-all duration-200"
                >
                  {article.featured && (
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-400/80 mb-2.5 uppercase tracking-wider">
                      <svg width="12" height="12" className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                      Featured
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-[13px] text-zinc-500 mb-2">
                    {author && (
                      <>
                        <span className="font-medium text-zinc-300">
                          @{author.handle}
                        </span>
                        {author.verified && (
                          <svg width="14" height="14" className="w-3.5 h-3.5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        )}
                        <span className="text-zinc-600">·</span>
                      </>
                    )}
                    {article.read_time_min && (
                      <span>{article.read_time_min} min read</span>
                    )}
                    {article.read_time_min && article.published_at && (
                      <span className="text-zinc-600">·</span>
                    )}
                    {article.published_at && (
                      <span>{formatDate(article.published_at)}</span>
                    )}
                  </div>

                  <h3 className="text-[17px] font-semibold text-zinc-100 group-hover:text-white mb-1.5 leading-snug line-clamp-2">
                    {article.title}
                  </h3>

                  {article.excerpt && (
                    <p className="text-sm text-zinc-500 leading-relaxed line-clamp-2 mb-3">
                      {article.excerpt}
                    </p>
                  )}

                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Categories */}
                    {categories.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        {categories.map((cat: any) => (
                          <span
                            key={cat.slug}
                            className="text-[11px] text-zinc-500 bg-zinc-800/60 px-2 py-0.5 rounded-full"
                          >
                            {cat.label}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Stats */}
                    {stats && (
                      <div className="flex items-center gap-4 text-xs text-zinc-600 ml-auto">
                        <span className="flex items-center gap-1">
                          <svg width="14" height="14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                          </svg>
                          {stats.like_count}
                        </span>
                        <span className="flex items-center gap-1">
                          <svg width="14" height="14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                          </svg>
                          {stats.bookmark_count}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Author link */}
                  {author && (
                    <div className="mt-3 pt-3 border-t border-zinc-800/40 text-xs text-zinc-600">
                      by{' '}
                      <Link
                        href={`/author/${author.handle}`}
                        className="text-zinc-500 hover:text-zinc-300 transition-colors relative z-10"
                      >
                        {author.display_name}
                      </Link>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
