import { NextResponse, NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * OAuth Callback Handler
 *
 * Handles OAuth redirects from any provider (GitHub, X, etc).
 * Supabase includes a `code` query param that we exchange
 * for a session. If this is a new user, we create their
 * profile and attempt to link their identity for author claiming.
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
  const meta = user.user_metadata;
  const provider = user.app_metadata?.provider;

  // Extract identity from OAuth metadata (works for GitHub, X, etc)
  const xHandle = meta?.user_name || meta?.preferred_username || null;
  const xUserId = meta?.provider_id || meta?.sub || null;
  const oAuthName = meta?.full_name || meta?.name || meta?.user_name || xHandle || 'User';
  const oAuthAvatar = meta?.avatar_url || meta?.picture || null;

  // For GitHub: use login as username fallback
  const username = meta?.user_name || meta?.preferred_username || `user_${user.id.slice(0, 8)}`;

  // Create/update profile
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (!existingProfile) {
    // New user - create profile
    const profileData: Record<string, any> = {
      id: user.id,
      username,
      avatar_url: oAuthAvatar,
    };
    // Only set X fields if this is a Twitter/X OAuth login
    if (provider === 'twitter') {
      profileData.x_handle = xHandle;
      profileData.x_user_id = xUserId;
    }
    await supabase.from('profiles').insert(profileData);
  } else {
    // Existing user - update avatar + X identity if applicable
    const updateData: Record<string, any> = {};
    if (oAuthAvatar) updateData.avatar_url = oAuthAvatar;
    if (provider === 'twitter') {
      updateData.x_handle = xHandle;
      updateData.x_user_id = xUserId;
    }
    if (Object.keys(updateData).length > 0) {
      await supabase.from('profiles').update(updateData).eq('id', user.id);
    }
  }

  // Auto-promote: if GitHub username matches ADMIN_GITHUB_USERNAME, set role to admin
  const adminGitHub = process.env.ADMIN_GITHUB_USERNAME;
  if (provider === 'github' && adminGitHub && username === adminGitHub) {
    const adminClient = (await import('@/lib/supabase-admin')).supabaseAdmin;
    await adminClient.from('profiles').update({ role: 'admin' }).eq('id', user.id);
    console.log(`Auto-promoted ${username} to admin via GitHub OAuth`);
  }

  // Auto-claim: if this X handle matches an author record, claim it
  if (provider === 'twitter' && xUserId) {
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
