-- Staged migration: apply only after explicit database-migration approval.
-- Additive API: leave get_feed available for old clients and RSS readers.
-- App first pages use this only when FEED_PAGINATION_V2=true. Deploy the
-- migration before enabling the flag; retain this function during rollback.
CREATE OR REPLACE FUNCTION public.get_feed_page(
  p_category_slug TEXT DEFAULT NULL,
  p_sort TEXT DEFAULT 'FOR_YOU',
  p_as_of TIMESTAMPTZ DEFAULT now(),
  p_cursor JSONB DEFAULT NULL,
  p_limit INT DEFAULT 21
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
  score NUMERIC,
  cursor_rank TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_sort TEXT := COALESCE(p_sort, 'FOR_YOU');
  v_as_of TIMESTAMPTZ := COALESCE(p_as_of, now());
  v_cursor_rank NUMERIC;
  v_cursor_date TIMESTAMPTZ;
  v_cursor_id UUID;
BEGIN
  IF v_sort NOT IN ('LATEST', 'POPULAR', 'FOR_YOU') THEN
    RAISE EXCEPTION 'Invalid feed sort' USING ERRCODE = '22023';
  END IF;
  IF p_cursor IS NOT NULL THEN
    IF jsonb_typeof(p_cursor) <> 'object'
       OR NOT (p_cursor ?& ARRAY['rank', 'published_at', 'id'])
       OR COALESCE(length(p_cursor->>'rank'), 0) NOT BETWEEN 1 AND 128
       OR NOT COALESCE((p_cursor->>'rank') ~ '^-?[0-9]+([.][0-9]+)?$', false)
       OR NOT COALESCE((p_cursor->>'id') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$', false) THEN
      RAISE EXCEPTION 'Invalid feed cursor' USING ERRCODE = '22023';
    END IF;
    v_cursor_rank := (p_cursor->>'rank')::numeric;
    v_cursor_date := (p_cursor->>'published_at')::timestamptz;
    v_cursor_id := (p_cursor->>'id')::uuid;
  END IF;

  RETURN QUERY
  WITH scored AS (
    SELECT
      a.id, a.title, a.excerpt, a.x_url, a.cover_image_url,
      a.read_time_min, a.featured, a.published_at, a.source,
      au.id AS author_id, au.handle AS author_handle,
      au.display_name AS author_display_name, au.avatar_url AS author_avatar_url,
      au.verified AS author_verified,
      COALESCE(s.like_count, 0) AS like_count,
      COALESCE(s.bookmark_count, 0) AS bookmark_count,
      COALESCE(s.comment_count, 0) AS comment_count,
      COALESCE(s.share_count, 0) AS share_count,
      COALESCE(s.avg_rating, 0) AS avg_rating,
      -- Same weights as feed_score, evaluated at the cursor's fixed reference
      -- time. Re-evaluating recency with now() on each page moves the boundary.
      (0.4 * CASE WHEN a.published_at IS NULL THEN 0 ELSE
        EXP(-0.04 * GREATEST(EXTRACT(EPOCH FROM (v_as_of - a.published_at)) / 3600.0, 0)) END
       + 0.4 * LN(GREATEST(COALESCE(s.like_count, 0)
           + COALESCE(s.bookmark_count, 0) * 2
           + COALESCE(s.comment_count, 0) * 1.5, 0) + 1) / LN(1001::numeric)
       + CASE WHEN a.featured THEN 0.2 ELSE 0 END) AS score
    FROM public.articles a
    JOIN public.authors au ON au.id = a.author_id
    LEFT JOIN public.article_stats s ON s.article_id = a.id
    WHERE a.status = 'published'
      -- New ingestion does not enter an already-started pagination session.
      AND (a.indexed_at IS NULL OR a.indexed_at <= v_as_of)
      AND (p_category_slug IS NULL OR EXISTS (
        SELECT 1 FROM public.article_categories ac
        JOIN public.categories c ON c.id = ac.category_id
        WHERE ac.article_id = a.id AND c.slug = p_category_slug
      ))
  ), ranked AS (
    SELECT scored.*, CASE v_sort
      WHEN 'LATEST' THEN 0::numeric
      WHEN 'POPULAR' THEN scored.like_count::numeric
      ELSE scored.score
    END AS sort_rank
    FROM scored
  )
  SELECT
    r.id, r.title, r.excerpt, r.x_url, r.cover_image_url,
    r.read_time_min, r.featured, r.published_at, r.source,
    r.author_id, r.author_handle, r.author_display_name,
    r.author_avatar_url, r.author_verified,
    r.like_count, r.bookmark_count, r.comment_count, r.share_count,
    r.avg_rating, r.score,
    -- Numeric text must survive JS without floating-point rounding.
    r.sort_rank::text AS cursor_rank
  FROM ranked r
  WHERE p_cursor IS NULL OR
    (r.sort_rank, COALESCE(r.published_at, '-infinity'::timestamptz), r.id) <
    (v_cursor_rank, COALESCE(v_cursor_date, '-infinity'::timestamptz), v_cursor_id)
  ORDER BY r.sort_rank DESC, r.published_at DESC NULLS LAST, r.id DESC
  -- Enforce the cap inside SQL, including for direct RPC callers.
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 21), 1), 51);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_feed_page(text, text, timestamptz, jsonb, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_feed_page(text, text, timestamptz, jsonb, int)
  TO service_role;

-- Legacy compatibility: keep the old signature and timestamp-cursor semantics
-- for cached HTML and RSS. Add deterministic ties and cap its previously
-- unbounded p_limit. Complete ranked keysets belong to get_feed_page above.
CREATE OR REPLACE FUNCTION public.get_feed(
  p_category_slug TEXT DEFAULT NULL,
  p_sort TEXT DEFAULT 'FOR_YOU',
  p_cursor TIMESTAMPTZ DEFAULT NULL,
  p_limit INT DEFAULT 20
) RETURNS TABLE (
  id UUID, title TEXT, excerpt TEXT, x_url TEXT, cover_image_url TEXT,
  read_time_min INT, featured BOOLEAN, published_at TIMESTAMPTZ, source TEXT,
  author_id UUID, author_handle TEXT, author_display_name TEXT,
  author_avatar_url TEXT, author_verified BOOLEAN,
  like_count INT, bookmark_count INT, comment_count INT, share_count INT,
  avg_rating NUMERIC, score NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    a.id, a.title, a.excerpt, a.x_url, a.cover_image_url,
    a.read_time_min, a.featured, a.published_at, a.source,
    au.id, au.handle, au.display_name, au.avatar_url, au.verified,
    COALESCE(s.like_count, 0), COALESCE(s.bookmark_count, 0),
    COALESCE(s.comment_count, 0), COALESCE(s.share_count, 0), COALESCE(s.avg_rating, 0),
    public.feed_score(a.published_at, COALESCE(s.like_count, 0),
      COALESCE(s.bookmark_count, 0), COALESCE(s.comment_count, 0), a.featured)
  FROM public.articles a
  JOIN public.authors au ON au.id = a.author_id
  LEFT JOIN public.article_stats s ON s.article_id = a.id
  WHERE a.status = 'published'
    AND (p_cursor IS NULL OR a.published_at < p_cursor)
    AND (p_category_slug IS NULL OR EXISTS (
      SELECT 1 FROM public.article_categories ac
      JOIN public.categories c ON c.id = ac.category_id
      WHERE ac.article_id = a.id AND c.slug = p_category_slug
    ))
  ORDER BY
    CASE WHEN p_sort = 'POPULAR' THEN COALESCE(s.like_count, 0) END DESC NULLS LAST,
    CASE WHEN p_sort = 'FOR_YOU' OR p_sort IS NULL THEN
      public.feed_score(a.published_at, COALESCE(s.like_count, 0),
        COALESCE(s.bookmark_count, 0), COALESCE(s.comment_count, 0), a.featured)
    END DESC NULLS LAST,
    a.published_at DESC NULLS LAST, a.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 51);
END;
$function$;
