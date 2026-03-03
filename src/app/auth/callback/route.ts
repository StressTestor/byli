import { NextResponse, NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * OAuth Callback Handler
 * 
 * X (Twitter) OAuth redirects here after authorization.
 * Supabase includes a `code` query param that we exchange
 * for a session. If this is a new user, we create their
 * profile and attempt to link their X identity for author claiming.
 * 
 * Flow:
 *   1. X redirects to /auth/callback?code=xxx
 *   2. Exchange code for Supabase session
 *   3. Check if profile exists, create if not
 *   4. Check if X handle matches an author record (auto-claim)
 *   5. Redirect to home (or onboarding if new)
 */

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') || '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  // Exchange the code for a session
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    console.error('OAuth callback error:', error);
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const user = data.session.user;
  const xMeta = user.user_metadata;

  // Extract X identity from OAuth metadata
  const xHandle = xMeta?.user_name || xMeta?.preferred_username || null;
  const xUserId = xMeta?.provider_id || xMeta?.sub || null;
  const xName = xMeta?.full_name || xMeta?.name || xHandle || 'User';
  const xAvatar = xMeta?.avatar_url || xMeta?.picture || null;

  // Create/update profile
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (!existingProfile) {
    // New user — create profile
    await supabase.from('profiles').insert({
      id: user.id,
      username: xHandle || `user_${user.id.slice(0, 8)}`,
      avatar_url: xAvatar,
      x_handle: xHandle,
      x_user_id: xUserId,
    });
  } else {
    // Existing user — update X identity if not set
    await supabase.from('profiles').update({
      x_handle: xHandle,
      x_user_id: xUserId,
      ...(xAvatar && { avatar_url: xAvatar }),
    }).eq('id', user.id);
  }

  // Auto-claim: if this X handle matches an author record, claim it
  if (xUserId) {
    const adminClient = (await import('@/lib/supabase-admin')).supabaseAdmin;

    const { data: author } = await adminClient
      .from('authors')
      .select('id, claimed')
      .eq('x_user_id', xUserId)
      .maybeSingle();

    if (author && !author.claimed) {
      await adminClient.from('authors').update({
        claimed: true,
        claimed_by: user.id,
      }).eq('id', author.id);

      console.log(`Auto-claimed author @${xHandle} for user ${user.id}`);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
