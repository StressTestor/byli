
-- Composite index for feed queries (status + published_at is the hot path)
CREATE INDEX IF NOT EXISTS idx_articles_published_status 
  ON articles(published_at DESC) 
  WHERE status = 'published';

-- Author feed queries
CREATE INDEX IF NOT EXISTS idx_articles_author_published 
  ON articles(author_id, published_at DESC) 
  WHERE status = 'published';

-- Popular/trending sort by likes
CREATE INDEX IF NOT EXISTS idx_article_stats_likes 
  ON article_stats(like_count DESC);

-- Category article lookups
CREATE INDEX IF NOT EXISTS idx_article_categories_article 
  ON article_categories(article_id);

CREATE INDEX IF NOT EXISTS idx_article_categories_category 
  ON article_categories(category_id);

-- Seed accounts approved lookup
CREATE INDEX IF NOT EXISTS idx_seed_accounts_status 
  ON seed_accounts(status) WHERE status = 'approved';
