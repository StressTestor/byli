// Helpers for the OAuth callback (src/app/auth/callback/route.ts).

const PLACEHOLDER_ORIGIN = 'https://callback.invalid';

// Only same-site paths survive. The callback redirects to `${origin}${next}`,
// so a value like "@evil.com" or ".evil.com" would change the host.
export function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  try {
    const url = new URL(raw, PLACEHOLDER_ORIGIN);
    if (url.origin !== PLACEHOLDER_ORIGIN) return '/';
    const path = `${url.pathname}${url.search}${url.hash}`;
    // Re-check after normalization: "/..//evil.com" resolves to "//evil.com".
    return path.startsWith('//') ? '/' : path;
  } catch {
    return '/';
  }
}

interface IdentityLike {
  provider: string;
  // The provider's own user id (GitHub numeric id). Auth's row UUID is identity_id.
  id?: string;
  identity_data?: Record<string, unknown>;
}

interface UserLike {
  identities?: IdentityLike[] | null;
}

// Decide whether this login belongs to the configured admin. Reads the GitHub
// identity record, which the provider sets, never user_metadata, which the user
// can change through auth.updateUser(). The numeric id is preferred because a
// GitHub login can be renamed and re-registered by someone else.
export function adminGitHubMatch(
  user: UserLike,
  admin: { id?: string; username?: string },
): 'id' | 'username' | null {
  const github = user.identities?.find((i) => i.provider === 'github');
  if (!github) return null;

  if (admin.id) return String(github.id) === admin.id ? 'id' : null;

  const login = github.identity_data?.user_name;
  if (admin.username && typeof login === 'string') {
    return login.toLowerCase() === admin.username.toLowerCase() ? 'username' : null;
  }
  return null;
}

// Same pattern as handle_new_user() and the signup form.
export const USERNAME_RE = /^[A-Za-z0-9_-]{2,39}$/;

// Username for a profile that has none yet: the provider login when it is a
// valid username, otherwise a stable placeholder from the user id.
export function oauthUsername(meta: Record<string, unknown>, userId: string): string {
  const login = meta.user_name ?? meta.preferred_username;
  if (typeof login === 'string' && USERNAME_RE.test(login)) return login;
  return `user_${userId.slice(0, 8)}`;
}
