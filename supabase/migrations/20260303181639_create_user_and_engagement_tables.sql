
CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    TEXT UNIQUE,
  avatar_url  TEXT,
  x_handle    TEXT,
  x_user_id   TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE bookmarks (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, article_id)
);

CREATE TABLE likes (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, article_id)
);

CREATE TABLE ratings (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  score       SMALLINT NOT NULL CHECK (score >= 1 AND score <= 5),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, article_id)
);

CREATE TABLE article_stats (
  article_id      UUID PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  like_count      INT DEFAULT 0,
  bookmark_count  INT DEFAULT 0,
  comment_count   INT DEFAULT 0,
  share_count     INT DEFAULT 0,
  rating_count    INT DEFAULT 0,
  rating_sum      INT DEFAULT 0,
  avg_rating      NUMERIC(3,2) DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE submissions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submitted_by  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  category_id   UUID REFERENCES categories(id) ON DELETE SET NULL,
  notes         TEXT,
  status        submission_status DEFAULT 'pending',
  article_id    UUID REFERENCES articles(id) ON DELETE SET NULL,
  reviewed_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE api_keys (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash    TEXT UNIQUE NOT NULL,
  label       TEXT,
  tier        TEXT DEFAULT 'developer' CHECK (tier IN ('developer', 'pro', 'enterprise')),
  rate_limit  INT DEFAULT 300,
  last_used   TIMESTAMPTZ,
  revoked     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);
