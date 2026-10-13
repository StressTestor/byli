// Generated from the live Supabase schema. Do not edit by hand; regenerate
// after any migration (Supabase MCP generate_typescript_types, or
// `supabase gen types typescript --project-id <ref>`).

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_logs: {
        Row: {
          action: string
          admin_id: string
          created_at: string | null
          id: string
          metadata: Json | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string | null
          id: string
          key_hash: string
          label: string | null
          last_used: string | null
          rate_limit: number | null
          revoked: boolean | null
          tier: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          key_hash: string
          label?: string | null
          last_used?: string | null
          rate_limit?: number | null
          revoked?: boolean | null
          tier?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          key_hash?: string
          label?: string | null
          last_used?: string | null
          rate_limit?: number | null
          revoked?: boolean | null
          tier?: string | null
          user_id?: string
        }
        Relationships: []
      }
      article_categories: {
        Row: {
          article_id: string
          category_id: string
        }
        Insert: {
          article_id: string
          category_id: string
        }
        Update: {
          article_id?: string
          category_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_categories_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      article_stats: {
        Row: {
          article_id: string
          avg_rating: number | null
          bookmark_count: number | null
          comment_count: number | null
          like_count: number | null
          rating_count: number | null
          rating_sum: number | null
          share_count: number | null
          updated_at: string | null
        }
        Insert: {
          article_id: string
          avg_rating?: number | null
          bookmark_count?: number | null
          comment_count?: number | null
          like_count?: number | null
          rating_count?: number | null
          rating_sum?: number | null
          share_count?: number | null
          updated_at?: string | null
        }
        Update: {
          article_id?: string
          avg_rating?: number | null
          bookmark_count?: number | null
          comment_count?: number | null
          like_count?: number | null
          rating_count?: number | null
          rating_sum?: number | null
          share_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "article_stats_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: true
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          author_id: string
          body_preview: string | null
          cover_image_url: string | null
          editorial_reason: string | null
          excerpt: string | null
          featured: boolean | null
          id: string
          indexed_at: string | null
          published_at: string | null
          quality_score: number | null
          read_time_min: number | null
          source: string | null
          status: Database["public"]["Enums"]["article_status"] | null
          title: string
          updated_at: string | null
          x_article_id: string | null
          x_url: string
        }
        Insert: {
          author_id: string
          body_preview?: string | null
          cover_image_url?: string | null
          editorial_reason?: string | null
          excerpt?: string | null
          featured?: boolean | null
          id?: string
          indexed_at?: string | null
          published_at?: string | null
          quality_score?: number | null
          read_time_min?: number | null
          source?: string | null
          status?: Database["public"]["Enums"]["article_status"] | null
          title: string
          updated_at?: string | null
          x_article_id?: string | null
          x_url: string
        }
        Update: {
          author_id?: string
          body_preview?: string | null
          cover_image_url?: string | null
          editorial_reason?: string | null
          excerpt?: string | null
          featured?: boolean | null
          id?: string
          indexed_at?: string | null
          published_at?: string | null
          quality_score?: number | null
          read_time_min?: number | null
          source?: string | null
          status?: Database["public"]["Enums"]["article_status"] | null
          title?: string
          updated_at?: string | null
          x_article_id?: string | null
          x_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "articles_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "authors"
            referencedColumns: ["id"]
          },
        ]
      }
      authors: {
        Row: {
          article_count: number | null
          avatar_url: string | null
          bio: string | null
          claimed: boolean | null
          claimed_by: string | null
          created_at: string | null
          display_name: string
          follower_count: number | null
          handle: string
          id: string
          updated_at: string | null
          verified: boolean | null
          x_user_id: string | null
        }
        Insert: {
          article_count?: number | null
          avatar_url?: string | null
          bio?: string | null
          claimed?: boolean | null
          claimed_by?: string | null
          created_at?: string | null
          display_name: string
          follower_count?: number | null
          handle: string
          id?: string
          updated_at?: string | null
          verified?: boolean | null
          x_user_id?: string | null
        }
        Update: {
          article_count?: number | null
          avatar_url?: string | null
          bio?: string | null
          claimed?: boolean | null
          claimed_by?: string | null
          created_at?: string | null
          display_name?: string
          follower_count?: number | null
          handle?: string
          id?: string
          updated_at?: string | null
          verified?: boolean | null
          x_user_id?: string | null
        }
        Relationships: []
      }
      bookmarks: {
        Row: {
          article_id: string
          created_at: string | null
          user_id: string
        }
        Insert: {
          article_id: string
          created_at?: string | null
          user_id: string
        }
        Update: {
          article_id?: string
          created_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookmarks_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string | null
          icon: string | null
          id: string
          label: string
          slug: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          icon?: string | null
          id?: string
          label: string
          slug: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          icon?: string | null
          id?: string
          label?: string
          slug?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      health_checks: {
        Row: {
          check_name: string
          component: string
          created_at: string | null
          id: string
          message: string | null
          metadata: Json | null
          response_time_ms: number | null
          run_id: string | null
          status: string
        }
        Insert: {
          check_name: string
          component: string
          created_at?: string | null
          id?: string
          message?: string | null
          metadata?: Json | null
          response_time_ms?: number | null
          run_id?: string | null
          status: string
        }
        Update: {
          check_name?: string
          component?: string
          created_at?: string | null
          id?: string
          message?: string | null
          metadata?: Json | null
          response_time_ms?: number | null
          run_id?: string | null
          status?: string
        }
        Relationships: []
      }
      ingest_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          started_at: string
          stats: Json
          status: string
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          stats?: Json
          status: string
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          stats?: Json
          status?: string
        }
        Relationships: []
      }
      likes: {
        Row: {
          article_id: string
          created_at: string | null
          user_id: string
        }
        Insert: {
          article_id: string
          created_at?: string | null
          user_id: string
        }
        Update: {
          article_id?: string
          created_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "likes_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          id: string
          role: string
          updated_at: string | null
          username: string | null
          x_handle: string | null
          x_user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          id: string
          role?: string
          updated_at?: string | null
          username?: string | null
          x_handle?: string | null
          x_user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          id?: string
          role?: string
          updated_at?: string | null
          username?: string | null
          x_handle?: string | null
          x_user_id?: string | null
        }
        Relationships: []
      }
      ratings: {
        Row: {
          article_id: string
          created_at: string | null
          score: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          article_id: string
          created_at?: string | null
          score: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          article_id?: string
          created_at?: string | null
          score?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratings_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      seed_accounts: {
        Row: {
          articles_found: number
          created_at: string
          handle: string
          high_yield: boolean
          id: string
          last_checked_at: string | null
          status: string
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          articles_found?: number
          created_at?: string
          handle: string
          high_yield?: boolean
          id?: string
          last_checked_at?: string | null
          status?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          articles_found?: number
          created_at?: string
          handle?: string
          high_yield?: boolean
          id?: string
          last_checked_at?: string | null
          status?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seed_accounts_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      site_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string | null
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string | null
          updated_by?: string | null
          value?: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string | null
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      submissions: {
        Row: {
          article_id: string | null
          category_id: string | null
          created_at: string | null
          id: string
          notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["submission_status"] | null
          submitted_by: string
          url: string
        }
        Insert: {
          article_id?: string | null
          category_id?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["submission_status"] | null
          submitted_by: string
          url: string
        }
        Update: {
          article_id?: string | null
          category_id?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["submission_status"] | null
          submitted_by?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      trending_topics: {
        Row: {
          fetched_at: string
          id: number
          name: string
          post_count: string | null
          query: string
          rank: number
        }
        Insert: {
          fetched_at?: string
          id?: number
          name: string
          post_count?: string | null
          query: string
          rank: number
        }
        Update: {
          fetched_at?: string
          id?: number
          name?: string
          post_count?: string | null
          query?: string
          rank?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      feed_score: {
        Args: {
          p_bookmark_count: number
          p_comment_count: number
          p_featured: boolean
          p_like_count: number
          p_published_at: string
        }
        Returns: number
      }
      get_feed: {
        Args: {
          p_category_slug?: string
          p_cursor?: string
          p_limit?: number
          p_sort?: string
        }
        Returns: {
          author_avatar_url: string
          author_display_name: string
          author_handle: string
          author_id: string
          author_verified: boolean
          avg_rating: number
          bookmark_count: number
          comment_count: number
          cover_image_url: string
          excerpt: string
          featured: boolean
          id: string
          like_count: number
          published_at: string
          read_time_min: number
          score: number
          share_count: number
          source: string
          title: string
          x_url: string
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      run_db_health_check: { Args: never; Returns: Json }
      search_articles: {
        Args: { p_limit?: number; p_offset?: number; p_query: string }
        Returns: {
          author_display_name: string
          author_handle: string
          author_verified: boolean
          cover_image_url: string
          excerpt: string
          id: string
          like_count: number
          published_at: string
          read_time_min: number
          relevance: number
          title: string
          x_url: string
        }[]
      }
    }
    Enums: {
      article_status: "pending" | "published" | "archived" | "rejected"
      submission_status: "pending" | "approved" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      article_status: ["pending", "published", "archived", "rejected"],
      submission_status: ["pending", "approved", "rejected"],
    },
  },
} as const
