// ─── Database Row Types ──────────────────────────────────────
// Row types come from the generated schema in ./supabase.ts.

import type { Tables } from './supabase';

export type ArticleStatus = 'pending' | 'published' | 'archived' | 'rejected';
export type SubmissionStatus = 'pending' | 'approved' | 'rejected';
export type ApiKeyTier = 'developer' | 'pro' | 'enterprise';
export type FeedSort = 'foryou' | 'latest' | 'popular' | 'top_rated';
export type Timeframe = 'day' | 'week' | 'month' | 'all_time';

export type Category = Tables<'categories'>;

export type Author = Tables<'authors'>;

export type Article = Tables<'articles'>;

export type ArticleStats = Tables<'article_stats'>;

export type UserRole = 'user' | 'moderator' | 'admin';

export type Profile = Tables<'profiles'>;

export type HealthCheck = Tables<'health_checks'>;

export type AdminLog = Tables<'admin_logs'>;

export type SiteSetting = Tables<'site_settings'>;

export type Bookmark = Tables<'bookmarks'>;

export type Like = Tables<'likes'>;

export type Rating = Tables<'ratings'>;

export type Submission = Tables<'submissions'>;

export type ApiKey = Tables<'api_keys'>;

// ─── Supabase Database Type Map ──────────────────────────────
// Generated from the live schema; see src/types/supabase.ts.

export type { Database, Json, Tables, TablesInsert, TablesUpdate } from './supabase';

export interface TrendingTopic {
  id: number;
  name: string;
  query: string;
  rank: number;
  post_count: string | null;
  fetched_at: string;
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
