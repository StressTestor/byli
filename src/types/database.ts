// ─── Database Row Types ──────────────────────────────────────
// These map 1:1 to PostgreSQL tables.

export type ArticleStatus = 'pending' | 'published' | 'archived' | 'rejected';
export type SubmissionStatus = 'pending' | 'approved' | 'rejected';
export type ApiKeyTier = 'developer' | 'pro' | 'enterprise';
export type FeedSort = 'foryou' | 'latest' | 'popular' | 'top_rated';
export type Timeframe = 'day' | 'week' | 'month' | 'all_time';

export interface Category {
  id: string;
  slug: string;
  label: string;
  icon: string | null;
  sort_order: number;
  created_at: string;
}

export interface Author {
  id: string;
  x_user_id: string | null;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  verified: boolean;
  claimed: boolean;
  claimed_by: string | null;
  follower_count: number;
  article_count: number;
  created_at: string;
  updated_at: string;
}

export interface Article {
  id: string;
  x_article_id: string | null;
  x_url: string;
  title: string;
  excerpt: string | null;
  body_preview: string | null;
  author_id: string;
  cover_image_url: string | null;
  read_time_min: number | null;
  status: ArticleStatus;
  featured: boolean;
  source: string;
  published_at: string | null;
  indexed_at: string;
  updated_at: string;
}

export interface ArticleStats {
  article_id: string;
  like_count: number;
  bookmark_count: number;
  comment_count: number;
  share_count: number;
  rating_count: number;
  rating_sum: number;
  avg_rating: number;
  updated_at: string;
}

export type UserRole = 'user' | 'moderator' | 'admin';

export interface Profile {
  id: string;
  username: string | null;
  avatar_url: string | null;
  x_handle: string | null;
  x_user_id: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface HealthCheck {
  id: string;
  check_name: string;
  status: 'healthy' | 'warning' | 'critical';
  message: string | null;
  details: Record<string, any> | null;
  checked_at: string;
}

export interface AdminLog {
  id: string;
  admin_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

export interface SiteSetting {
  key: string;
  value: string;
  updated_at: string;
}

export interface Bookmark {
  user_id: string;
  article_id: string;
  created_at: string;
}

export interface Like {
  user_id: string;
  article_id: string;
  created_at: string;
}

export interface Rating {
  user_id: string;
  article_id: string;
  score: number;
  created_at: string;
  updated_at: string;
}

export interface Submission {
  id: string;
  submitted_by: string;
  url: string;
  category_id: string | null;
  notes: string | null;
  status: SubmissionStatus;
  article_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface ApiKey {
  id: string;
  user_id: string;
  key_hash: string;
  label: string | null;
  tier: ApiKeyTier;
  rate_limit: number;
  last_used: string | null;
  revoked: boolean;
  created_at: string;
}

// ─── Supabase Database Type Map ──────────────────────────────
// Used with supabase.from('table').select<Type>()

export interface Database {
  public: {
    Tables: {
      categories: { Row: Category; Insert: Omit<Category, 'id' | 'created_at'>; Update: Partial<Category> };
      authors: { Row: Author; Insert: Omit<Author, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Author> };
      articles: { Row: Article; Insert: Omit<Article, 'id' | 'indexed_at' | 'updated_at'>; Update: Partial<Article> };
      article_stats: { Row: ArticleStats; Insert: Pick<ArticleStats, 'article_id'>; Update: Partial<ArticleStats> };
      article_categories: { Row: { article_id: string; category_id: string }; Insert: { article_id: string; category_id: string }; Update: never };
      profiles: { Row: Profile; Insert: Omit<Profile, 'created_at' | 'updated_at'>; Update: Partial<Profile> };
      bookmarks: { Row: Bookmark; Insert: Omit<Bookmark, 'created_at'>; Update: never };
      likes: { Row: Like; Insert: Omit<Like, 'created_at'>; Update: never };
      ratings: { Row: Rating; Insert: Omit<Rating, 'created_at' | 'updated_at'>; Update: Pick<Rating, 'score'> };
      submissions: { Row: Submission; Insert: Omit<Submission, 'id' | 'created_at'>; Update: Partial<Submission> };
      api_keys: { Row: ApiKey; Insert: Omit<ApiKey, 'id' | 'created_at'>; Update: Partial<ApiKey> };
    };
    Functions: {
      search_articles: { Args: { query: string; lim?: number; off_set?: number }; Returns: Article[] };
      get_feed: {
        Args: { p_category_slug?: string; p_sort?: string; p_limit?: number; p_cursor?: string };
        Returns: FeedRow[];
      };
      feed_score: {
        Args: { p_published_at: string; p_like_count: number; p_bookmark_count: number; p_avg_rating: number; p_featured: boolean };
        Returns: number;
      };
    };
  };
}

// ─── Composite Types (for API/UI) ────────────────────────────

export interface FeedRow {
  article_id: string;
  title: string;
  excerpt: string | null;
  x_url: string;
  author_handle: string;
  author_name: string;
  author_verified: boolean;
  category_slugs: string[];
  like_count: number;
  bookmark_count: number;
  avg_rating: number;
  featured: boolean;
  published_at: string;
  read_time_min: number | null;
  score: number;
}

export interface ArticleWithRelations extends Article {
  author: Author;
  categories: Category[];
  stats: ArticleStats;
}

export interface FeedArticle {
  id: string;
  title: string;
  excerpt: string | null;
  xUrl: string;
  author: {
    handle: string;
    displayName: string;
    verified: boolean;
    avatarUrl: string | null;
  };
  categories: string[];
  stats: {
    likeCount: number;
    bookmarkCount: number;
    avgRating: number;
  };
  featured: boolean;
  publishedAt: string;
  readTimeMin: number | null;
  score: number;
  viewerHasLiked: boolean;
  viewerHasBookmarked: boolean;
}
