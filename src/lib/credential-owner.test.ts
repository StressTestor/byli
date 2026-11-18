import { describe, expect, it } from 'vitest';
import { CREDENTIAL_OWNER_GITHUB_ID, CREDENTIAL_OWNER_USER_ID, isCredentialOwner } from './credential-owner';
const identity = { provider: 'github', id: CREDENTIAL_OWNER_GITHUB_ID };
const owner = { id: CREDENTIAL_OWNER_USER_ID, identities: [identity] };
describe('credential lifecycle owner identity', () => {
  it('requires both verified stable account IDs', () => {
    expect(isCredentialOwner(owner as any)).toBe(true);
    expect(isCredentialOwner({ ...owner, id: 'another-admin' } as any)).toBe(false);
    expect(isCredentialOwner({ ...owner, identities: [{ ...identity, id: 'another-github-id' }] } as any)).toBe(false);
  });
  it.each([null, { id: CREDENTIAL_OWNER_USER_ID }, { id: CREDENTIAL_OWNER_USER_ID, identities: [] }])('fails closed for missing identity %j', user => {
    expect(isCredentialOwner(user as any)).toBe(false);
  });
  it('does not trust spoofed usernames, emails, role or identity_data', () => {
    const fake = {
      id: 'another-user', role: 'admin', email: 'owner@example.com', username: 'StressTestor',
      identities: [{ provider: 'github', id: 'attacker', identity_data: {
        user_name: 'StressTestor', preferred_username: 'StressTestor',
        sub: CREDENTIAL_OWNER_GITHUB_ID, id: CREDENTIAL_OWNER_GITHUB_ID,
      } }],
    };
    expect(isCredentialOwner(fake as any)).toBe(false);
    expect(isCredentialOwner({ ...fake, id: CREDENTIAL_OWNER_USER_ID } as any)).toBe(false);
  });
  it('rejects a matching provider ID on a different provider', () => {
    expect(isCredentialOwner({ ...owner, identities: [{ ...identity, provider: 'email' }] } as any)).toBe(false);
  });
  it('accepts additional identities without relying on array order', () => {
    expect(isCredentialOwner({ ...owner, identities: [{ provider: 'email', id: 'other' }, identity] } as any)).toBe(true);
  });
});
