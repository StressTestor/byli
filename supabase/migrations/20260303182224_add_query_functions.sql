
-- ═══════════════════════════════════════════════════════════════
-- feed_score(): composite ranking function
-- Weights: 40% recency, 40% engagement, 20% featured
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.feed_score(
  p_published_at timestamptz,
  p_like_count int,
  p_bookmark_count int,
  p_comment_count int,
  p_featured boolean
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  age_hours numeric;
  recency_score numeric;
  engagement_raw numeric;
  engagement_score numeric;
  featured_score numeric;
BEGIN
  -- Recency: exponential decay over 72 hours
  age_hours := EXTRACT(EPOCH FROM (now() - p_published_at)) / 3600.0;
  recency_score := EXP(-0.04 * GREATEST(age_hours, 0));

  -- Engagement: log-scaled composite
  engagement_raw := p_like_count + (p_bookmark_count * 2) + (p_comment_count * 1.5);
  engagement_score := CASE
    WHEN engagement_raw <= 0 THEN 0
    ELSE LN(engagement_raw + 1) / LN(1001) -- normalize to 0-1 range (1000 = max expected)
  END;

  -- Featured boost
  featured_score := CASE WHEN p_featured THEN 1.0 ELSE 0.0 END;

  RETURN (0.4 * recency_score) + (0.4 * engagement_score) + (0.2 * featured_score);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- get_feed(): main feed query with cursor pagination
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_feed(
  p_category_slug text DEFAULT NULL,
  p_sort text DEFAULT 'FOR_YOU',  -- FOR_YOU, LATEST, POPULAR
  p_cursor timestamptz DEFAULT NULL,
  p_limit int DEFAULT 20
) RETURNS TABLE (
  id uuid,
  title text,
  excerpt text,
  x_url text,
  cover_image_url text,
  read_time_min int,
  featured boolean,
  published_at timestamptz,
  source text,
  author_id uuid,
  author_handle text,
  author_display_name text,
  author_avatar_url text,
  author_verified boolean,
  like_count int,
  bookmark_count int,
  comment_count int,
  share_count int,
  avg_rating numeric,
  score numeric
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.title,
    a.excerpt,
    a.x_url,
    a.cover_image_url,
    a.read_time_min,
    a.featured,
    a.published_at,
    a.source,
    au.id AS author_id,
    au.handle AS author_handle,
    au.display_name AS author_display_name,
    au.avatar_url AS author_avatar_url,
    au.verified AS author_verified,
    COALESCE(s.like_count, 0) AS like_count,
    COALESCE(s.bookmark_count, 0) AS bookmark_count,
    COALESCE(s.comment_count, 0) AS comment_count,
    COALESCE(s.share_count, 0) AS share_count,
    COALESCE(s.avg_rating, 0) AS avg_rating,
    feed_score(a.published_at, COALESCE(s.like_count,0), COALESCE(s.bookmark_count,0), COALESCE(s.comment_count,0), a.featured) AS score
  FROM public.articles a
  JOIN public.authors au ON a.author_id = au.id
  LEFT JOIN public.article_stats s ON a.id = s.article_id
  LEFT JOIN public.article_categories ac ON a.id = ac.article_id
  LEFT JOIN public.categories c ON ac.category_id = c.id
  WHERE a.status = 'published'
    AND (p_category_slug IS NULL OR c.slug = p_category_slug)
    AND (p_cursor IS NULL OR a.published_at < p_cursor)
  GROUP BY a.id, au.id, s.like_count, s.bookmark_count, s.comment_count, s.share_count, s.avg_rating
  ORDER BY
    CASE p_sort
      WHEN 'LATEST' THEN a.published_at
      ELSE NULL
    END DESC NULLS LAST,
    CASE p_sort
      WHEN 'POPULAR' THEN COALESCE(s.like_count, 0)
      ELSE NULL
    END DESC NULLS LAST,
    CASE
      WHEN p_sort = 'FOR_YOU' OR p_sort IS NULL
      THEN feed_score(a.published_at, COALESCE(s.like_count,0), COALESCE(s.bookmark_count,0), COALESCE(s.comment_count,0), a.featured)
      ELSE NULL
    END DESC NULLS LAST
  LIMIT p_limit;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- search_articles(): full-text + trigram search
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.search_articles(
  p_query text,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
) RETURNS TABLE (
  id uuid,
  title text,
  excerpt text,
  x_url text,
  cover_image_url text,
  read_time_min int,
  published_at timestamptz,
  author_handle text,
  author_display_name text,
  author_verified boolean,
  like_count int,
  relevance real
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.title,
    a.excerpt,
    a.x_url,
    a.cover_image_url,
    a.read_time_min,
    a.published_at,
    au.handle AS author_handle,
    au.display_name AS author_display_name,
    au.verified AS author_verified,
    COALESCE(s.like_count, 0) AS like_count,
    GREATEST(
      ts_rank(to_tsvector('english', a.title || ' ' || COALESCE(a.excerpt, '')), plainto_tsquery('english', p_query)),
      similarity(a.title, p_query)
    ) AS relevance
  FROM public.articles a
  JOIN public.authors au ON a.author_id = au.id
  LEFT JOIN public.article_stats s ON a.id = s.article_id
  WHERE a.status = 'published'
    AND (
      to_tsvector('english', a.title || ' ' || COALESCE(a.excerpt, '')) @@ plainto_tsquery('english', p_query)
      OR similarity(a.title, p_query) > 0.15
      OR a.title ILIKE '%' || p_query || '%'
    )
  ORDER BY relevance DESC, a.published_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
