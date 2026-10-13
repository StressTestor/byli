
-- Fix feed_score: correct search_path syntax (was quoted as single string)
CREATE OR REPLACE FUNCTION public.feed_score(
  p_published_at TIMESTAMPTZ,
  p_like_count INT,
  p_bookmark_count INT,
  p_comment_count INT,
  p_featured BOOLEAN
) RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $function$
DECLARE
  age_hours numeric;
  recency_score numeric;
  engagement_raw numeric;
  engagement_score numeric;
  featured_score numeric;
BEGIN
  age_hours := EXTRACT(EPOCH FROM (now() - p_published_at)) / 3600.0;
  recency_score := EXP(-0.04 * GREATEST(age_hours, 0));

  engagement_raw := p_like_count + (p_bookmark_count * 2) + (p_comment_count * 1.5);
  engagement_score := CASE
    WHEN engagement_raw <= 0 THEN 0
    ELSE LN(engagement_raw + 1) / LN(1001)
  END;

  featured_score := CASE WHEN p_featured THEN 1.0 ELSE 0.0 END;

  RETURN (0.4 * recency_score) + (0.4 * engagement_score) + (0.2 * featured_score);
END;
$function$;

-- Fix get_feed: correct search_path syntax
CREATE OR REPLACE FUNCTION public.get_feed(
  p_category_slug TEXT DEFAULT NULL,
  p_sort TEXT DEFAULT 'FOR_YOU',
  p_cursor TIMESTAMPTZ DEFAULT NULL,
  p_limit INT DEFAULT 20
) RETURNS TABLE (
  id UUID,
  title TEXT,
  excerpt TEXT,
  x_url TEXT,
  cover_image_url TEXT,
  read_time_min INT,
  featured BOOLEAN,
  published_at TIMESTAMPTZ,
  source TEXT,
  author_id UUID,
  author_handle TEXT,
  author_display_name TEXT,
  author_avatar_url TEXT,
  author_verified BOOLEAN,
  like_count INT,
  bookmark_count INT,
  comment_count INT,
  share_count INT,
  avg_rating NUMERIC,
  score NUMERIC
)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $function$
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
$function$;
