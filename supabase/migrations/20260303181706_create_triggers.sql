
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

-- Update like_count
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

-- Update bookmark_count
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

-- Update rating stats
CREATE OR REPLACE FUNCTION fn_update_rating_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE article_stats SET
      rating_count = GREATEST(rating_count - 1, 0),
      rating_sum = GREATEST(rating_sum - OLD.score, 0),
      avg_rating = CASE WHEN rating_count - 1 > 0 THEN ROUND((rating_sum - OLD.score)::numeric / (rating_count - 1), 2) ELSE 0 END,
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

-- Update author article_count
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

-- Auto-update updated_at
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
