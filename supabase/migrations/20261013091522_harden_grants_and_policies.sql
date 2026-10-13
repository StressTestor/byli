-- Tighten what anon and authenticated can execute and insert.
--
-- Functions get EXECUTE for PUBLIC by default, and Supabase also grants anon and
-- authenticated explicitly, so every SECURITY DEFINER function here was callable
-- by anyone holding the anon key. No RLS policy calls any of these functions
-- (they all inline the admin EXISTS check), so the revokes below only affect
-- direct RPC calls.

-- Trigger functions never need a caller EXECUTE grant.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_role_change() FROM PUBLIC, anon, authenticated;

-- is_admin() is called over RPC by the signed-in admin routes only.
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;

-- run_db_health_check() writes to health_checks as its owner. The admin pages
-- call it as the signed-in user, so keep authenticated and check inside.
REVOKE EXECUTE ON FUNCTION public.run_db_health_check() FROM PUBLIC, anon;

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
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'run_db_health_check is admin only' USING ERRCODE = '42501';
  END IF;

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

-- profiles: anon and authenticated held a table-level INSERT grant, which
-- covers the role column. Signup creates the row through handle_new_user();
-- the auth callback only ever inserts the columns granted here.
REVOKE INSERT ON public.profiles FROM anon, authenticated;
GRANT INSERT (id, username, avatar_url, x_handle, x_user_id)
  ON public.profiles TO authenticated;

-- Extend the role guard to INSERT so a profile can't be created with a
-- non-default role outside the service role or an existing admin.
CREATE OR REPLACE FUNCTION public.prevent_profile_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.role IS DISTINCT FROM 'user')
     OR (TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role) THEN
    IF coalesce(auth.role(), '') <> 'service_role'
       AND NOT EXISTS (
         SELECT 1 FROM public.profiles p
         WHERE p.id = auth.uid() AND p.role = 'admin'
       ) THEN
      RAISE EXCEPTION 'profiles.role may only be changed by an administrator';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_prevent_role_insert ON public.profiles;
CREATE TRIGGER trg_profiles_prevent_role_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_role_change();

-- submissions: 20260308184557 re-created the two user policies that
-- 20260303182159 already defines under other names.
DROP POLICY IF EXISTS "Users can submit articles" ON public.submissions;
DROP POLICY IF EXISTS "Users can view own submissions" ON public.submissions;
