
CREATE TYPE article_status AS ENUM ('pending', 'published', 'archived', 'rejected');
CREATE TYPE submission_status AS ENUM ('pending', 'approved', 'rejected');

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

CREATE TABLE authors (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  x_user_id     TEXT UNIQUE,
  handle        TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  bio           TEXT,
  verified      BOOLEAN DEFAULT false,
  claimed       BOOLEAN DEFAULT false,
  claimed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  follower_count INT DEFAULT 0,
  article_count  INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE articles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  x_article_id    TEXT UNIQUE,
  x_url           TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  excerpt         TEXT,
  body_preview    TEXT,
  author_id       UUID NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  cover_image_url TEXT,
  read_time_min   INT,
  status          article_status DEFAULT 'pending',
  featured        BOOLEAN DEFAULT false,
  source          TEXT DEFAULT 'manual',
  published_at    TIMESTAMPTZ,
  indexed_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE article_categories (
  article_id   UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  category_id  UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, category_id)
);
