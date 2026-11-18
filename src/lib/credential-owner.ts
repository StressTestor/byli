import type { User } from '@supabase/supabase-js';
// Verified against byline's auth.identities on 2026-11-18. These are identifiers,
// not secrets. A username/email/role change must never confer key ownership.
export const CREDENTIAL_OWNER_USER_ID = '11ca70b7-4ecf-4446-a6cb-47eb80e84d44';
export const CREDENTIAL_OWNER_GITHUB_ID = '212606152';
export function isCredentialOwner(user: Pick<User, 'id' | 'identities'> | null) {
  return user?.id === CREDENTIAL_OWNER_USER_ID && user.identities?.some(identity =>
    identity.provider === 'github' && identity.id === CREDENTIAL_OWNER_GITHUB_ID
  ) === true;
}
