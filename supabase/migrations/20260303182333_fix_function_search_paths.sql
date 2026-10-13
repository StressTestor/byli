
-- Fix mutable search_path on all functions
-- Setting search_path = '' prevents search path injection attacks

ALTER FUNCTION public.fn_create_article_stats() SET search_path = '';
ALTER FUNCTION public.fn_update_like_count() SET search_path = '';
ALTER FUNCTION public.fn_update_bookmark_count() SET search_path = '';
ALTER FUNCTION public.fn_update_rating_stats() SET search_path = '';
ALTER FUNCTION public.fn_update_author_article_count() SET search_path = '';
ALTER FUNCTION public.fn_updated_at() SET search_path = '';
ALTER FUNCTION public.feed_score(timestamptz, int, int, int, boolean) SET search_path = '';
ALTER FUNCTION public.get_feed(text, text, timestamptz, int) SET search_path = '';
ALTER FUNCTION public.search_articles(text, int, int) SET search_path = '';

-- Move pg_trgm extension out of public schema
-- Note: on Supabase free tier, extensions schema may already exist
CREATE SCHEMA IF NOT EXISTS extensions;
-- Replay note: guarded so a fresh project, where 20260303181614 already
-- created pg_trgm in extensions, doesn't need to own the extension.
DO $$
BEGIN
  IF (SELECT extnamespace::regnamespace::text FROM pg_extension WHERE extname = 'pg_trgm') <> 'extensions' THEN
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  END IF;
END
$$;
