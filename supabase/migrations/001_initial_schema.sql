-- ============================================================
-- Byline Database Schema v1.0
-- Migration: 001_initial_schema
-- 
-- Run against Supabase PostgreSQL via:
--   supabase db push
-- Or paste into Supabase SQL Editor
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- fuzzy text search

-- ─── ENUMS ───────────────────────────────────────────────────

CREATE TYPE article_status AS ENUM ('pending', 'published', 'archived', 'rejected');
CREATE TYPE submission_status AS ENUM ('pending', 'approved', 'rejected');

-- ─── CATEGORIES ──────────────────────────────────────────────

CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug        TEXT UNIQUE NOT NULL,
  label       TEXT NOT NULL,
  icon        TEXT,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO categories (slug, label, icon, sort_order) VALUES
  ('tech',      'Technology', '⚡', 1),
  ('politics',  'Politics',   '🏛', 2),
  ('science',   'Science',    '🔬', 3),
  ('business',  'Business',   '📈', 4),
  ('culture',   'Culture',    '🎭', 5),
  ('sports',    'Sports',     '⚽', 6),
  ('opinion',   'Opinion',    '💬', 7);

-- ─── AUTHORS ─────────────────────────────────────────────────
-- Authors are X users who have published Articles.
-- They exist independently of Byline user accounts.
-- "claimed" means the X user has verified ownership via OAuth.

CREATE TABLE authors (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  x_user_id     TEXT UNIQUE,          -- X's internal user ID
  handle        TEXT UNIQUE NOT NULL,  -- @handle without the @
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  bio           TEXT,
  verified      BOOLEAN DEFAULT false, -- verified on X
  claimed       BOOLEAN DEFAULT false, -- claimed on Byline via OAuth
  claimed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  follower_count INT DEFAULT 0,
  article_count  INT DEFAULT 0,       -- denormalized, updated by trigger
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ─── ARTICLES ────────────────────────────────────────────────
-- The core asset. Each row = one indexed X Article.

CREATE TABLE articles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  x_article_id    TEXT UNIQUE,           -- X's internal article ID (for dedup)
  x_url           TEXT UNIQUE NOT NULL,  -- canonical URL on X
  title           TEXT NOT NULL,
  excerpt         TEXT,                  -- first ~300 chars
  body_preview    TEXT,                  -- first ~500 chars for API
  author_id       UUID NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  cover_image_url TEXT,
  read_time_min   INT,
  status          article_status DEFAULT 'pending',
  featured        BOOLEAN DEFAULT false,
  source          TEXT DEFAULT 'manual', -- 'netrows', 'community', 'author', 'manual'
  published_at    TIMESTAMPTZ,           -- when published on X
  indexed_at      TIMESTAMPTZ DEFAULT now(), -- when we ingested it
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ─── ARTICLE <-> CATEGORY (many-to-many) ────────────────────

CREATE TABLE article_categories (
  article_id   UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  category_id  UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, category_id)
);

-- ─── USERS (extends Supabase auth.users) ─────────────────────
-- Public profile data. id matches auth.users.id.

CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    TEXT UNIQUE,
  avatar_url  TEXT,
  x_handle    TEXT,               -- linked X handle (if OAuth'd)
  x_user_id   TEXT,               -- linked X user ID
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ─── BOOKMARKS ───────────────────────────────────────────────

CREATE TABLE bookmarks (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, article_id)
);

-- ─── LIKES ───────────────────────────────────────────────────

CREATE TABLE likes (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, article_id)
);

-- ─── RATINGS ─────────────────────────────────────────────────

CREATE TABLE ratings (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  score       SMALLINT NOT NULL CHECK (score >= 1 AND score <= 5),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, article_id)
);

-- ─── ARTICLE STATS (denormalized counters) ───────────────────
-- Updated by triggers. Avoids COUNT(*) on every page load.

CREATE TABLE article_stats (
  article_id      UUID PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  like_count      INT DEFAULT 0,
  bookmark_count  INT DEFAULT 0,
  comment_count   INT DEFAULT 0,  -- reserved for future
  share_count     INT DEFAULT 0,  -- reserved for future
  rating_count    INT DEFAULT 0,
  rating_sum      INT DEFAULT 0,
  avg_rating      NUMERIC(3,2) DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ─── SUBMISSIONS (community review queue) ────────────────────

CREATE TABLE submissions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submitted_by  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  category_id   UUID REFERENCES categories(id) ON DELETE SET NULL,
  notes         TEXT,
  status        submission_status DEFAULT 'pending',
  article_id    UUID REFERENCES articles(id) ON DELETE SET NULL, -- linked after approval
  reviewed_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ─── API KEYS ────────────────────────────────────────────────

CREATE TABLE api_keys (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash    TEXT UNIQUE NOT NULL,  -- SHA-256 of the actual key
  label       TEXT,
  tier        TEXT DEFAULT 'developer' CHECK (tier IN ('developer', 'pro', 'enterprise')),
  rate_limit  INT DEFAULT 300,       -- requests per minute
  last_used   TIMESTAMPTZ,
  revoked     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════

-- Articles
CREATE INDEX idx_articles_published_at ON articles(published_at DESC) WHERE status = 'published';
CREATE INDEX idx_articles_status ON articles(status);
CREATE INDEX idx_articles_author ON articles(author_id);
CREATE INDEX idx_articles_featured ON articles(featured) WHERE featured = true AND status = 'published';
CREATE INDEX idx_articles_source ON articles(source);

-- Full-text search on title + excerpt
CREATE INDEX idx_articles_fts ON articles
  USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(excerpt, '')));

-- Trigram index for fuzzy/partial matching
CREATE INDEX idx_articles_title_trgm ON articles USING gin(title gin_trgm_ops);

-- Article categories
CREATE INDEX idx_article_categories_category ON article_categories(category_id);
CREATE INDEX idx_article_categories_article ON article_categories(article_id);

-- Engagement
CREATE INDEX idx_bookmarks_user ON bookmarks(user_id);
CREATE INDEX idx_bookmarks_article ON bookmarks(article_id);
CREATE INDEX idx_likes_user ON likes(user_id);
CREATE INDEX idx_likes_article ON likes(article_id);
CREATE INDEX idx_ratings_article ON ratings(article_id);

-- Stats (for popular sort)
CREATE INDEX idx_article_stats_likes ON article_stats(like_count DESC);
CREATE INDEX idx_article_stats_bookmarks ON article_stats(bookmark_count DESC);
CREATE INDEX idx_article_stats_rating ON article_stats(avg_rating DESC) WHERE rating_count >= 3;

-- Authors
CREATE INDEX idx_authors_handle ON authors(handle);
CREATE INDEX idx_authors_claimed ON authors(claimed) WHERE claimed = true;

-- Submissions
CREATE INDEX idx_submissions_status ON submissions(status) WHERE status = 'pending';
CREATE INDEX idx_submissions_user ON submissions(submitted_by);

-- API keys
CREATE INDEX idx_api_keys_user ON api_keys(user_id) WHERE revoked = false;

-- ═══════════════════════════════════════════════════════════════
-- TRIGGERS
-- ═══════════════════════════════════════════════════════════════

-- Auto-create article_stats row when article is inserted
CREATE OR REPLACE FUNCTION fn_create_article_stats()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO article_stats (article_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_article_stats
  AFTER INSERT ON articles
  FOR EACH ROW EXECUTE FUNCTION fn_create_article_stats();

-- Update like_count on likes insert/delete
CREATE OR REPLACE FUNCTION fn_update_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE article_stats SET like_count = like_count + 1, updated_at = now() WHERE article_id = NEW.article_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE article_stats SET like_count = GREATEST(like_count - 1, 0), updated_at = now() WHERE article_id = OLD.article_id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_like_insert AFTER INSERT ON likes FOR EACH ROW EXECUTE FUNCTION fn_update_like_count();
CREATE TRIGGER trg_like_delete AFTER DELETE ON likes FOR EACH ROW EXECUTE FUNCTION fn_update_like_count();

-- Update bookmark_count on bookmarks insert/delete
CREATE OR REPLACE FUNCTION fn_update_bookmark_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE article_stats SET bookmark_count = bookmark_count + 1, updated_at = now() WHERE article_id = NEW.article_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE article_stats SET bookmark_count = GREATEST(bookmark_count - 1, 0), updated_at = now() WHERE article_id = OLD.article_id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bookmark_insert AFTER INSERT ON bookmarks FOR EACH ROW EXECUTE FUNCTION fn_update_bookmark_count();
CREATE TRIGGER trg_bookmark_delete AFTER DELETE ON bookmarks FOR EACH ROW EXECUTE FUNCTION fn_update_bookmark_count();

-- Update rating stats on ratings insert/update/delete
CREATE OR REPLACE FUNCTION fn_update_rating_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE article_stats SET
      rating_count = GREATEST(rating_count - 1, 0),
      rating_sum = GREATEST(rating_sum - OLD.score, 0),
      avg_rating = CASE
        WHEN rating_count - 1 > 0 THEN ROUND((rating_sum - OLD.score)::numeric / (rating_count - 1), 2)
        ELSE 0
      END,
      updated_at = now()
    WHERE article_id = OLD.article_id;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE article_stats SET
      rating_sum = rating_sum - OLD.score + NEW.score,
      avg_rating = ROUND((rating_sum - OLD.score + NEW.score)::numeric / rating_count, 2),
      updated_at = now()
    WHERE article_id = NEW.article_id;
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    UPDATE article_stats SET
      rating_count = rating_count + 1,
      rating_sum = rating_sum + NEW.score,
      avg_rating = ROUND((rating_sum + NEW.score)::numeric / (rating_count + 1), 2),
      updated_at = now()
    WHERE article_id = NEW.article_id;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rating_insert AFTER INSERT ON ratings FOR EACH ROW EXECUTE FUNCTION fn_update_rating_stats();
CREATE TRIGGER trg_rating_update AFTER UPDATE ON ratings FOR EACH ROW EXECUTE FUNCTION fn_update_rating_stats();
CREATE TRIGGER trg_rating_delete AFTER DELETE ON ratings FOR EACH ROW EXECUTE FUNCTION fn_update_rating_stats();

-- Update author article_count when articles change
CREATE OR REPLACE FUNCTION fn_update_author_article_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'published' THEN
    UPDATE authors SET article_count = article_count + 1 WHERE id = NEW.author_id;
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'published' THEN
    UPDATE authors SET article_count = GREATEST(article_count - 1, 0) WHERE id = OLD.author_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status != 'published' AND NEW.status = 'published' THEN
      UPDATE authors SET article_count = article_count + 1 WHERE id = NEW.author_id;
    ELSIF OLD.status = 'published' AND NEW.status != 'published' THEN
      UPDATE authors SET article_count = GREATEST(article_count - 1, 0) WHERE id = NEW.author_id;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_author_article_count
  AFTER INSERT OR UPDATE OR DELETE ON articles
  FOR EACH ROW EXECUTE FUNCTION fn_update_author_article_count();

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION fn_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_authors_updated BEFORE UPDATE ON authors FOR EACH ROW EXECUTE FUNCTION fn_updated_at();
CREATE TRIGGER trg_articles_updated BEFORE UPDATE ON articles FOR EACH ROW EXECUTE FUNCTION fn_updated_at();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION fn_updated_at();
CREATE TRIGGER trg_ratings_updated BEFORE UPDATE ON ratings FOR EACH ROW EXECUTE FUNCTION fn_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Profiles: public read, own write
CREATE POLICY profiles_select ON profiles FOR SELECT USING (true);
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Bookmarks: own data only
CREATE POLICY bookmarks_select ON bookmarks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY bookmarks_insert ON bookmarks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY bookmarks_delete ON bookmarks FOR DELETE USING (auth.uid() = user_id);

-- Likes: own data only
CREATE POLICY likes_select ON likes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY likes_insert ON likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY likes_delete ON likes FOR DELETE USING (auth.uid() = user_id);

-- Ratings: own data only
CREATE POLICY ratings_select ON ratings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY ratings_insert ON ratings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY ratings_update ON ratings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY ratings_delete ON ratings FOR DELETE USING (auth.uid() = user_id);

-- Submissions: own submissions readable, anyone can insert
CREATE POLICY submissions_select ON submissions FOR SELECT USING (auth.uid() = submitted_by);
CREATE POLICY submissions_insert ON submissions FOR INSERT WITH CHECK (auth.uid() = submitted_by);

-- API keys: own keys only
CREATE POLICY api_keys_select ON api_keys FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY api_keys_insert ON api_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY api_keys_update ON api_keys FOR UPDATE USING (auth.uid() = user_id);

-- Articles, authors, categories, article_stats: public read (no RLS needed for reads)
-- These are read via service role or anon key with public access
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY articles_select ON articles FOR SELECT USING (true);
CREATE POLICY authors_select ON authors FOR SELECT USING (true);
CREATE POLICY categories_select ON categories FOR SELECT USING (true);
CREATE POLICY article_stats_select ON article_stats FOR SELECT USING (true);
CREATE POLICY article_categories_select ON article_categories FOR SELECT USING (true);

-- ═══════════════════════════════════════════════════════════════
-- FUNCTIONS (API helpers)
-- ═══════════════════════════════════════════════════════════════

-- Full-text search function
CREATE OR REPLACE FUNCTION search_articles(query TEXT, lim INT DEFAULT 20, off_set INT DEFAULT 0)
RETURNS SETOF articles AS $$
  SELECT a.*
  FROM articles a
  WHERE a.status = 'published'
    AND to_tsvector('english', coalesce(a.title, '') || ' ' || coalesce(a.excerpt, ''))
        @@ plainto_tsquery('english', query)
  ORDER BY ts_rank(
    to_tsvector('english', coalesce(a.title, '') || ' ' || coalesce(a.excerpt, '')),
    plainto_tsquery('english', query)
  ) DESC
  LIMIT lim OFFSET off_set;
$$ LANGUAGE sql STABLE;

-- "For You" feed scoring function
-- Weights: recency 40%, engagement 40%, featured 20%
CREATE OR REPLACE FUNCTION feed_score(
  p_published_at TIMESTAMPTZ,
  p_like_count INT,
  p_bookmark_count INT,
  p_avg_rating NUMERIC,
  p_featured BOOLEAN
) RETURNS NUMERIC AS $$
DECLARE
  hours_old NUMERIC;
  recency_score NUMERIC;
  engagement_score NUMERIC;
  featured_score NUMERIC;
BEGIN
  -- Recency: exponential decay, half-life 24h
  hours_old := EXTRACT(EPOCH FROM (now() - p_published_at)) / 3600.0;
  recency_score := EXP(-0.693 * hours_old / 24.0); -- ln(2)/24

  -- Engagement: normalized composite
  -- Bookmarks weighted 2x likes, ratings weighted 3x
  engagement_score := LEAST(
    (p_like_count + (2.0 * p_bookmark_count) + (3.0 * COALESCE(p_avg_rating, 0) * 100)) / 1000.0,
    1.0
  );

  -- Featured: flat boost
  featured_score := CASE WHEN p_featured THEN 1.0 ELSE 0.0 END;

  RETURN (0.4 * recency_score) + (0.4 * engagement_score) + (0.2 * featured_score);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Convenience: get feed with scores
CREATE OR REPLACE FUNCTION get_feed(
  p_category_slug TEXT DEFAULT NULL,
  p_sort TEXT DEFAULT 'foryou', -- 'foryou', 'latest', 'popular'
  p_limit INT DEFAULT 20,
  p_cursor TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE (
  article_id UUID,
  title TEXT,
  excerpt TEXT,
  x_url TEXT,
  author_handle TEXT,
  author_name TEXT,
  author_verified BOOLEAN,
  category_slugs TEXT[],
  like_count INT,
  bookmark_count INT,
  avg_rating NUMERIC,
  featured BOOLEAN,
  published_at TIMESTAMPTZ,
  read_time_min INT,
  score NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id AS article_id,
    a.title,
    a.excerpt,
    a.x_url,
    au.handle AS author_handle,
    au.display_name AS author_name,
    au.verified AS author_verified,
    ARRAY_AGG(c.slug) AS category_slugs,
    s.like_count,
    s.bookmark_count,
    s.avg_rating,
    a.featured,
    a.published_at,
    a.read_time_min,
    CASE
      WHEN p_sort = 'foryou' THEN feed_score(a.published_at, s.like_count, s.bookmark_count, s.avg_rating, a.featured)
      WHEN p_sort = 'popular' THEN s.like_count::NUMERIC
      ELSE EXTRACT(EPOCH FROM a.published_at)::NUMERIC
    END AS score
  FROM articles a
  JOIN authors au ON au.id = a.author_id
  JOIN article_stats s ON s.article_id = a.id
  LEFT JOIN article_categories ac ON ac.article_id = a.id
  LEFT JOIN categories c ON c.id = ac.category_id
  WHERE a.status = 'published'
    AND (p_category_slug IS NULL OR c.slug = p_category_slug)
    AND (p_cursor IS NULL OR a.published_at < p_cursor)
  GROUP BY a.id, au.id, s.article_id
  ORDER BY
    CASE
      WHEN p_sort = 'foryou' THEN feed_score(a.published_at, s.like_count, s.bookmark_count, s.avg_rating, a.featured)
      WHEN p_sort = 'popular' THEN s.like_count::NUMERIC
      ELSE EXTRACT(EPOCH FROM a.published_at)::NUMERIC
    END DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;
