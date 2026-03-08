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
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public files (icons, images)
     * - API routes that handle their own auth (graphql, ingest, feed)
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.png|api/graphql|api/ingest|feed).*)',
  ],
};
