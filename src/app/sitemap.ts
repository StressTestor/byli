import type { MetadataRoute } from 'next'
import { supabaseAdmin } from '@/lib/supabase-admin'

const baseUrl = 'https://linkdrift.app'

const CATEGORIES = [
  'tech', 'politics', 'science', 'business', 'culture', 'sports', 'opinion',
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // static pages always included regardless of DB state
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    ...CATEGORIES.map(slug => ({
      url: `${baseUrl}/category/${slug}`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.7,
    })),
    {
      url: `${baseUrl}/about`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ]

  // dynamic pages from DB — wrapped in try/catch so sitemap still works if DB is down
  let articleRoutes: MetadataRoute.Sitemap = []
  let authorRoutes: MetadataRoute.Sitemap = []

  try {
    const { data: articles, error: articlesError } = await supabaseAdmin
      .from('articles')
      .select('id, published_at')
      .eq('status', 'published')

    if (!articlesError && articles) {
      articleRoutes = articles.map(article => ({
        url: `${baseUrl}/article/${article.id}`,
        lastModified: article.published_at ? new Date(article.published_at) : new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      }))
    }
  } catch {
    // DB query failed — continue with static pages only
  }

  try {
    const { data: authors, error: authorsError } = await supabaseAdmin
      .from('authors')
      .select('handle')

    if (!authorsError && authors) {
      // dedupe handles just in case
      const seen = new Set<string>()
      authorRoutes = authors
        .filter(a => {
          if (!a.handle || seen.has(a.handle)) return false
          seen.add(a.handle)
          return true
        })
        .map(author => ({
          url: `${baseUrl}/author/${author.handle}`,
          lastModified: new Date(),
          changeFrequency: 'weekly' as const,
          priority: 0.6,
        }))
    }
  } catch {
    // DB query failed — continue without author pages
  }

  return [...staticRoutes, ...articleRoutes, ...authorRoutes]
}
