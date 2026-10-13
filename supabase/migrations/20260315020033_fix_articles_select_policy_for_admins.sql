
-- Replace the SELECT policy so admins can see all articles (including archived)
-- while regular users only see published ones.
DROP POLICY "Articles are publicly readable" ON articles;

CREATE POLICY "articles_select"
  ON articles FOR SELECT
  USING (
    status = 'published'
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
