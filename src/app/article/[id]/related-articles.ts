import { supabaseAdmin } from '@/lib/supabase-admin';

export async function getRelatedArticles(articleId: string, authorId: string) {
  // These cards appear under "more from @author", so a category match must
  // never fill an empty slot. Filter visibility before applying the limit.
  try {
    const { data, error } = await supabaseAdmin
      .from('articles')
      .select(`
        id, title, excerpt, x_url, read_time_min, published_at, cover_image_url,
        author:authors(handle, display_name, verified),
        stats:article_stats(like_count, bookmark_count)
      `)
      .eq('author_id', authorId)
      .eq('status', 'published')
      .neq('id', articleId)
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .limit(4);

    return error ? [] : data ?? [];
  } catch {
    // Recommendations are optional; an unavailable lookup must not break the
    // article page or substitute unrelated/unpublished articles.
    return [];
  }
}
