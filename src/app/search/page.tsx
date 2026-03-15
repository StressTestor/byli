import { supabaseAdmin } from '@/lib/supabase-admin';
import type { Metadata } from 'next';
import Link from 'next/link';

interface SearchPageProps {
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const { q } = await searchParams;
  const title = q ? `"${q}" - Search - Linkdrift` : 'Search - Linkdrift';
  return {
    title,
    description: q ? `Search results for "${q}" on Linkdrift` : 'Search X Articles on Linkdrift',
    robots: { index: false },
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q } = await searchParams;
  const query = (q || '').trim();

  let articles: any[] = [];

  if (query.length >= 2) {
    const { data } = await supabaseAdmin
      .from('articles')
      .select(`
        id, title, excerpt, published_at, read_time_min, cover_image_url,
        authors!inner(handle, display_name, avatar_url, verified),
        article_stats!inner(like_count, bookmark_count, comment_count)
      `)
      .eq('status', 'published')
      .textSearch('title', query, { type: 'websearch' })
      .order('published_at', { ascending: false })
      .limit(30);

    articles = data || [];

    // If title search got nothing, try excerpt
    if (articles.length === 0) {
      const { data: excerptResults } = await supabaseAdmin
        .from('articles')
        .select(`
          id, title, excerpt, published_at, read_time_min, cover_image_url,
          authors!inner(handle, display_name, avatar_url, verified),
          article_stats!inner(like_count, bookmark_count, comment_count)
        `)
        .eq('status', 'published')
        .ilike('title', `%${query}%`)
        .order('published_at', { ascending: false })
        .limit(30);

      articles = excerptResults || [];
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="border-b border-zinc-800/40">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/" className="text-lg font-bold text-white hover:text-zinc-300 transition-colors">
            Linkdrift
          </Link>
          <form action="/search" method="GET" className="flex-1">
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="Search articles..."
              className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors"
              autoFocus
            />
          </form>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {!query ? (
          <p className="text-zinc-500 text-sm">Enter a search term to find articles.</p>
        ) : articles.length === 0 ? (
          <p className="text-zinc-500 text-sm">No results for &quot;{query}&quot;</p>
        ) : (
          <>
            <p className="text-zinc-500 text-sm mb-4">
              {articles.length} result{articles.length !== 1 ? 's' : ''} for &quot;{query}&quot;
            </p>
            <div className="space-y-4">
              {articles.map((article: any) => {
                const author = article.authors;
                const stats = article.article_stats;
                const date = new Date(article.published_at).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                });

                return (
                  <Link
                    key={article.id}
                    href={`/article/${article.id}`}
                    className="block border border-zinc-800/40 rounded-xl p-4 hover:border-zinc-700 transition-colors"
                  >
                    <h2 className="text-base font-medium text-white mb-1 line-clamp-2">
                      {article.title}
                    </h2>
                    {article.excerpt && (
                      <p className="text-sm text-zinc-500 line-clamp-2 mb-2">{article.excerpt}</p>
                    )}
                    <div className="flex items-center gap-2 text-xs text-zinc-600">
                      {author?.avatar_url && (
                        <img
                          src={author.avatar_url}
                          alt=""
                          className="w-4 h-4 rounded-full"
                        />
                      )}
                      <span className="text-zinc-400">{author?.display_name}</span>
                      <span>@{author?.handle}</span>
                      <span>·</span>
                      <span>{date}</span>
                      {article.read_time_min && (
                        <>
                          <span>·</span>
                          <span>{article.read_time_min} min</span>
                        </>
                      )}
                      {stats?.like_count > 0 && (
                        <>
                          <span>·</span>
                          <span>{stats.like_count} likes</span>
                        </>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
