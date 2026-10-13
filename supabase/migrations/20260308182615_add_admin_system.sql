
-- Add admin role to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user' 
CHECK (role IN ('user', 'admin', 'moderator'));

-- Admin activity log
CREATE TABLE IF NOT EXISTS public.admin_logs (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  admin_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL,
  target_type text, -- 'article', 'submission', 'user', 'system'
  target_id text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Health checks table — stores results from automated test runs
CREATE TABLE IF NOT EXISTS public.health_checks (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  check_name text NOT NULL,
  component text NOT NULL, -- 'auth', 'ingestion', 'api', 'frontend', 'database'
  status text NOT NULL CHECK (status IN ('pass', 'fail', 'warn', 'skip')),
  message text,
  response_time_ms integer,
  metadata jsonb DEFAULT '{}',
  run_id uuid, -- groups checks from the same run
  created_at timestamptz DEFAULT now()
);

-- Index for fast lookups on health checks
CREATE INDEX idx_health_checks_component ON public.health_checks(component, created_at DESC);
CREATE INDEX idx_health_checks_run ON public.health_checks(run_id);
CREATE INDEX idx_health_checks_status ON public.health_checks(status, created_at DESC);
CREATE INDEX idx_admin_logs_admin ON public.admin_logs(admin_id, created_at DESC);

-- Site settings table — key/value store for admin-configurable settings
CREATE TABLE IF NOT EXISTS public.site_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}',
  description text,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz DEFAULT now()
);

-- Seed default settings
INSERT INTO public.site_settings (key, value, description) VALUES
  ('ingestion_enabled', 'true', 'Whether the automated article ingestion pipeline is active'),
  ('submissions_enabled', 'true', 'Whether users can submit articles'),
  ('signup_enabled', 'true', 'Whether new user registration is open'),
  ('maintenance_mode', 'false', 'Puts the site in maintenance mode'),
  ('featured_limit', '5', 'Max number of featured articles shown')
ON CONFLICT (key) DO NOTHING;

-- RLS policies
ALTER TABLE public.health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

-- Health checks: admins can read/write, everyone else blocked
CREATE POLICY "Admins can manage health checks" ON public.health_checks
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Admin logs: admins can read, system can write
CREATE POLICY "Admins can view logs" ON public.admin_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can insert logs" ON public.admin_logs
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Site settings: admins can read/write, public can read
CREATE POLICY "Anyone can read settings" ON public.site_settings
  FOR SELECT USING (true);

CREATE POLICY "Admins can update settings" ON public.site_settings
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Helper function: check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: run a basic database health check
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
  -- Check article counts
  SELECT COUNT(*) INTO article_count FROM public.articles WHERE status = 'published';
  SELECT COUNT(*) INTO author_count FROM public.authors;
  SELECT COUNT(*) INTO submission_count FROM public.submissions WHERE status = 'pending';
  SELECT COUNT(*) INTO category_count FROM public.categories;
  
  -- Check latest content timestamps
  SELECT MAX(indexed_at) INTO latest_article FROM public.articles;
  SELECT MAX(indexed_at) INTO latest_ingestion FROM public.articles WHERE source != 'manual';
  
  -- Log results
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
