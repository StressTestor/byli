
-- Functions that use pg_trgm (similarity) need access to the extensions schema
-- Setting a fixed search_path (not mutable/default) satisfies the security linter
ALTER FUNCTION public.search_articles(text, int, int) SET search_path = 'public, extensions';
ALTER FUNCTION public.get_feed(text, text, timestamptz, int) SET search_path = 'public, extensions';
ALTER FUNCTION public.feed_score(timestamptz, int, int, int, boolean) SET search_path = 'public, extensions';

-- Trigger functions also reference public tables, need that in path
ALTER FUNCTION public.fn_create_article_stats() SET search_path = 'public';
ALTER FUNCTION public.fn_update_like_count() SET search_path = 'public';
ALTER FUNCTION public.fn_update_bookmark_count() SET search_path = 'public';
ALTER FUNCTION public.fn_update_rating_stats() SET search_path = 'public';
ALTER FUNCTION public.fn_update_author_article_count() SET search_path = 'public';
ALTER FUNCTION public.fn_updated_at() SET search_path = 'public';
