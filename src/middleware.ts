import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Middleware runs on every request.
 * 
 * 1. Refreshes Supabase auth session (keeps JWT alive)
 * 2. Redirects unauthenticated users from protected routes to /login
 * 3. Redirects authenticated users away from auth pages to /
 */

// Routes that require authentication
const PROTECTED_ROUTES = ['/bookmarks', '/settings', '/submit', '/api-keys', '/admin'];

// Routes that should redirect to / if already authenticated
const AUTH_ROUTES = ['/login', '/signup', '/forgot'];

export async function middleware(req: NextRequest) {
  let response = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            req.cookies.set(name, value);
          });
          response = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Refresh session — this is the main purpose of the middleware.
  // Must be called on every request to keep the JWT alive.
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = req.nextUrl;

  // Redirect unauthenticated users from protected routes
  if (!user && PROTECTED_ROUTES.some(route => pathname.startsWith(route))) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from auth pages
  if (user && AUTH_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return response;
}

export const config = {
  /*
   * Positive allowlist: ONLY run on routes that need auth.
   *
   * The old negative-lookahead matcher ran getUser() (a network round-trip to
   * Supabase) on every public content page — home, /article, /author,
   * /category, /search — adding latency and load to the pages we actually want
   * to rank. Those pages don't need a server-side session: the browser client
   * refreshes its own JWT, and the session self-heals on the next protected hit.
   *
   * Each protected route is listed twice — bare (`/admin`) and nested
   * (`/admin/:path*`) — so an unauthenticated hit to the bare route still runs
   * the middleware and gets redirected. Keep this list in sync with
   * PROTECTED_ROUTES and AUTH_ROUTES above (the in-function `startsWith` checks
   * are the precise gate; this matcher is the coarse pre-filter).
   */
  matcher: [
    '/bookmarks',
    '/bookmarks/:path*',
    '/settings',
    '/settings/:path*',
    '/submit',
    '/submit/:path*',
    '/api-keys',
    '/api-keys/:path*',
    '/admin',
    '/admin/:path*',
    '/login',
    '/signup',
    '/forgot',
  ],
};
