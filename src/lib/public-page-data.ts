import { cache } from 'react';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { visibleArticleBodyPreview } from '@/lib/ingest-utils';
import type { Article, Author, Category, ArticleStats } from '@/types/database';

interface ArticleRow extends Article {
  author: Author;
  categories: Array<{ category: Category }>;
  stats: ArticleStats;
}

// React's cache is scoped to the current server render. It deduplicates the
// page/metadata lookup without persisting unpublished/deleted content between
// requests, unlike an ISR or shared-data cache. Never use this for auth state.
export const getArticle = cache(async (id: string): Promise<ArticleRow | null> => {
  const { data, error } = await supabaseAdmin.from('articles').select(`
      *,
      author:authors(*),
      categories:article_categories(category:categories(*)),
      stats:article_stats(*)
    `).eq('id', id).eq('status', 'published').single();
  if (error || !data) return null;
  const row = data as unknown as ArticleRow;
  return { ...row, body_preview: visibleArticleBodyPreview(row.body_preview) };
});

export const getAuthor = cache(async (handle: string) => {
  const { data } = await supabaseAdmin.from('authors').select('*').eq('handle', handle).single();
  return data;
});
