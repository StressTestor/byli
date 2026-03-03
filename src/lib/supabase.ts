import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database';

// ─── Environment ─────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ─── Browser Client (client components) ──────────────────────
// Uses anon key + RLS. User's JWT attached automatically.

export function createBrowserClient() {
  return createClient<Database>(supabaseUrl, supabaseAnonKey);
}

// ─── Server Client (server components, API routes) ───────────
// Reads auth from cookies. Respects RLS.

export async function createSupabaseServer() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from Server Component — can't set cookies.
          // Middleware will handle refresh.
        }
      },
    },
  });
}

// ─── Admin Client (service role, bypasses RLS) ───────────────
// ONLY for server-side operations: ingestion workers, admin tasks.
// Never expose to client.

export const supabaseAdmin = createClient<Database>(
  supabaseUrl,
  supabaseServiceKey,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
