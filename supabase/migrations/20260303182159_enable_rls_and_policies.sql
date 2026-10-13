
-- ═══════════════════════════════════════════════════════════════
-- Enable RLS on all public tables
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- PUBLIC READ: anyone can read published articles, authors, categories, stats
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY "Articles are publicly readable"
  ON public.articles FOR SELECT
  USING (status = 'published');

CREATE POLICY "Authors are publicly readable"
  ON public.authors FOR SELECT
  USING (true);

CREATE POLICY "Categories are publicly readable"
  ON public.categories FOR SELECT
  USING (true);

CREATE POLICY "Article categories are publicly readable"
  ON public.article_categories FOR SELECT
  USING (true);

CREATE POLICY "Article stats are publicly readable"
  ON public.article_stats FOR SELECT
  USING (true);

-- ═══════════════════════════════════════════════════════════════
-- PROFILES: users can read all, but only update their own
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY "Profiles are publicly readable"
  ON public.profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ═══════════════════════════════════════════════════════════════
-- LIKES: users manage their own
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY "Users can read their own likes"
  ON public.likes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own likes"
  ON public.likes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own likes"
  ON public.likes FOR DELETE
  USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════
-- BOOKMARKS: users manage their own
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY "Users can read their own bookmarks"
  ON public.bookmarks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own bookmarks"
  ON public.bookmarks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own bookmarks"
  ON public.bookmarks FOR DELETE
  USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════
-- RATINGS: users manage their own
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY "Users can read their own ratings"
  ON public.ratings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own ratings"
  ON public.ratings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ratings"
  ON public.ratings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own ratings"
  ON public.ratings FOR DELETE
  USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════
-- SUBMISSIONS: users can create, read their own
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY "Users can read their own submissions"
  ON public.submissions FOR SELECT
  USING (auth.uid() = submitted_by);

CREATE POLICY "Users can create submissions"
  ON public.submissions FOR INSERT
  WITH CHECK (auth.uid() = submitted_by);

-- ═══════════════════════════════════════════════════════════════
-- API KEYS: users manage their own
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY "Users can read their own API keys"
  ON public.api_keys FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own API keys"
  ON public.api_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own API keys"
  ON public.api_keys FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own API keys"
  ON public.api_keys FOR DELETE
  USING (auth.uid() = user_id);
