-- 20260303182346 quoted the list as one string, so search_path became the
-- single nonexistent schema "public, extensions" and similarity() (pg_trgm, in
-- extensions) failed to resolve. 20260303221342 fixed get_feed and feed_score
-- the same way; search_articles was missed.
ALTER FUNCTION public.search_articles(text, int, int) SET search_path = public, extensions;
