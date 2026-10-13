
-- Fix mutable search_path on all three functions (MEDIUM severity security issue)

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = '';

CREATE OR REPLACE FUNCTION public.run_db_health_check()
RETURNS jsonb AS $$
DECLARE
  result jsonb;
  run_uuid uuid := extensions.uuid_generate_v4();
  article_count int;
  author_count int;
  submission_count int;
  category_count int;
  latest_article timestamptz;
  latest_ingestion timestamptz;
BEGIN
  SELECT COUNT(*) INTO article_count FROM public.articles WHERE status = 'published';
  SELECT COUNT(*) INTO author_count FROM public.authors;
  SELECT COUNT(*) INTO submission_count FROM public.submissions WHERE status = 'pending';
  SELECT COUNT(*) INTO category_count FROM public.categories;
  SELECT MAX(indexed_at) INTO latest_article FROM public.articles;
  SELECT MAX(indexed_at) INTO latest_ingestion FROM public.articles WHERE source != 'manual';

  INSERT INTO public.health_checks (check_name, component, status, message, metadata, run_id) VALUES
    ('article_count', 'database', 
     CASE WHEN article_count > 0 THEN 'pass' ELSE 'warn' END,
     article_count || ' published articles',
     jsonb_build_object('count', article_count), run_uuid),
    ('author_count', 'database',
     CASE WHEN author_count > 0 THEN 'pass' ELSE 'warn' END,
     author_count || ' authors indexed',
     jsonb_build_object('count', author_count), run_uuid),
    ('pending_submissions', 'database',
     CASE WHEN submission_count = 0 THEN 'pass' ELSE 'warn' END,
     submission_count || ' pending submissions awaiting review',
     jsonb_build_object('count', submission_count), run_uuid),
    ('categories', 'database',
     CASE WHEN category_count >= 5 THEN 'pass' ELSE 'warn' END,
     category_count || ' categories configured',
     jsonb_build_object('count', category_count), run_uuid),
    ('content_freshness', 'ingestion',
     CASE 
       WHEN latest_article > now() - interval '24 hours' THEN 'pass'
       WHEN latest_article > now() - interval '72 hours' THEN 'warn'
       ELSE 'fail'
     END,
     'Latest article indexed: ' || COALESCE(latest_article::text, 'never'),
     jsonb_build_object('latest_article', latest_article, 'latest_ingestion', latest_ingestion), run_uuid);

  result := jsonb_build_object(
    'run_id', run_uuid,
    'timestamp', now(),
    'articles', article_count,
    'authors', author_count,
    'pending_submissions', submission_count,
    'categories', category_count,
    'latest_article', latest_article,
    'latest_ingestion', latest_ingestion
  );
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, created_at, updated_at)
  VALUES (NEW.id, now(), now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';
