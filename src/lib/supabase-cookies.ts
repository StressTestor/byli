import type { CookieOptions } from '@supabase/ssr';

// @supabase/ssr 0.5 overloads createServerClient (getAll/setAll vs the
// deprecated get/set/remove), which defeats contextual typing for setAll.
export type CookieToSet = { name: string; value: string; options: CookieOptions };
