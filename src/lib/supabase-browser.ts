import { createBrowserClient as createSSRBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// See createSupabaseServer: same @supabase/ssr 0.5 generics mismatch.
export function createBrowserClient(): SupabaseClient<Database> {
  return createSSRBrowserClient<Database>(supabaseUrl, supabaseAnonKey) as unknown as SupabaseClient<Database>;
}
