import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database';
import type { CookieToSet } from '@/lib/supabase-cookies';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// @supabase/ssr 0.5 passes its generics to SupabaseClient in an order
// supabase-js 2.98 no longer uses, so table writes type as never. Declare the
// client type here, once, until @supabase/ssr is upgraded.
export async function createSupabaseServer(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();

  const client = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from Server Component — can't set cookies.
        }
      },
    },
  });
  return client as unknown as SupabaseClient<Database>;
}
