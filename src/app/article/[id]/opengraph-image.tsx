import { createClient } from '@supabase/supabase-js';
import { unstable_noStore } from 'next/cache';
import type { Database } from '@/types/database';
import { getArticleOgBytes, type ArticleOgSource } from '@/lib/article-og';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const alt = 'Linkdrift Article';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Dedicated client: never alter the cache behavior of the shared admin client.
const publicationDb = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false }, global: {
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  } },
);
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  unstable_noStore();
  const { id } = await params;
  // This live query is OUTSIDE unstable_cache. Direct browser/DB moderation and
  // deletion are honored on the next request without cache invalidation hooks.
  const { data: article, error } = await publicationDb.from('articles').select(`
    title, author:authors(handle, display_name),
    categories:article_categories(category:categories(label))
  `).eq('id', id).eq('status', 'published').single();
  const visible = error ? null : article;
  const author = visible?.author as { handle?: string; display_name?: string } | null;
  const categories = visible?.categories as { category?: { label?: string } | null }[] | undefined;
  const source: ArticleOgSource = {
    title: visible?.title || 'Article Not Found',
    authorName: author?.display_name || '', authorHandle: author?.handle || '',
    categoryLabel: categories?.map(item => item.category?.label).filter(Boolean)[0] || '',
  };
  const bytes = await getArticleOgBytes(source);
  // ImageResponse defaults to a public year-long cache. Never inherit that:
  // clients/CDNs must recheck publication, even when raster bytes are reused.
  return new Response(new Uint8Array(bytes), { headers: {
    'Content-Type': contentType,
    'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  } });
}
