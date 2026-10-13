import { NextResponse, NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { CookieToSet } from '@/lib/supabase-cookies';
import { safeNextPath, adminGitHubMatch, oauthUsername } from '@/lib/auth-callback';
import { cookies } from 'next/headers';

/**
 * OAuth Callback Handler
 *
 * Handles OAuth redirects from any provider (GitHub, X, etc).
 * Supabase includes a `code` query param that we exchange
 * for a session, then fill in the profile created by handle_new_user(),
 * promote the configured admin, and link X identities for author claiming.
 */

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next'));

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
        setAll(cookiesToSet: CookieToSet[]) {
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

  // X identity comes from the provider-set identity record. user_metadata is
  // editable by the user (auth.updateUser) and feeds author claiming below.
  const xIdentity = user.identities?.find((i) => i.provider === 'twitter');
  const xHandle = (xIdentity?.identity_data?.user_name as string | undefined) || null;
  const xUserId = xIdentity?.id || null;
  const oAuthAvatar = meta?.avatar_url || meta?.picture || null;

  // handle_new_user() creates the profile row at signup. Fill in what it
  // can't know: avatar, X identity, and a username when none was set.
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username')
    .eq('id', user.id)
    .maybeSingle();

  const updates: { username?: string; avatar_url?: string; x_handle?: string; x_user_id?: string } = {};
  if (oAuthAvatar) updates.avatar_url = oAuthAvatar;
  if (xIdentity) {
    if (xHandle) updates.x_handle = xHandle;
    if (xUserId) updates.x_user_id = xUserId;
  }
  if (!profile?.username) updates.username = oauthUsername(meta ?? {}, user.id);

  const writeProfile = (values: typeof updates) =>
    profile
      ? supabase.from('profiles').update(values).eq('id', user.id)
      : supabase.from('profiles').insert({ id: user.id, ...values });

  if (Object.keys(updates).length > 0) {
    let { error: profileError } = await writeProfile(updates);
    // 23505: the provider login is already someone else's username.
    if (profileError?.code === '23505' && updates.username) {
      ({ error: profileError } = await writeProfile({ ...updates, username: `user_${user.id.slice(0, 8)}` }));
    }
    if (profileError) console.error('[auth] profile write failed:', profileError.message);
  }

  const adminMatch = adminGitHubMatch(user, {
    id: process.env.ADMIN_GITHUB_ID,
    username: process.env.ADMIN_GITHUB_USERNAME,
  });
  if (adminMatch) {
    if (adminMatch === 'username') {
      console.warn('[auth] admin matched by GitHub login; set ADMIN_GITHUB_ID to match by numeric id');
    }
    const adminClient = (await import('@/lib/supabase-admin')).supabaseAdmin;
    const { error: promoteError } = await adminClient
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', user.id);
    // Security-relevant: keep an audit breadcrumb of admin promotions.
    if (promoteError) console.error('[auth] admin promotion failed:', promoteError.message);
    else console.warn(`[auth] promoted ${user.id} to admin via GitHub ${adminMatch}`);
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
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
