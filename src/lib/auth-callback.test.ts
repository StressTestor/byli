import { describe, it, expect } from 'vitest';
import { safeNextPath, adminGitHubMatch, oauthUsername } from './auth-callback';

describe('safeNextPath', () => {
  it('keeps same-site paths with query and hash', () => {
    expect(safeNextPath('/article/abc?x=1#top')).toBe('/article/abc?x=1#top');
    expect(safeNextPath('/')).toBe('/');
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['userinfo host', '@evil.com'],
    ['host suffix', '.evil.com'],
    ['protocol-relative', '//evil.com/path'],
    ['backslash', '/\\evil.com'],
    ['absolute url', 'https://evil.com/'],
    ['javascript', 'javascript:alert(1)'],
    ['relative', 'article/abc'],
    ['dot segment to protocol-relative', '/..//evil.com'],
    ['dot segment variant', '/.//evil.com'],
    ['nested dot segments', '/a/../..//evil.com'],
  ])('falls back to / for %s', (_label, raw) => {
    expect(safeNextPath(raw)).toBe('/');
  });
});

const githubUser = (id: string, login: string) => ({
  identities: [{ provider: 'github', id, identity_id: '9b1c-uuid', identity_data: { user_name: login } }],
  user_metadata: { user_name: 'spoofed' },
});

describe('adminGitHubMatch', () => {
  it('matches on the GitHub numeric id from the identity, as a string', () => {
    expect(adminGitHubMatch(githubUser('12345', 'joe'), { id: '12345' })).toBe('id');
    expect(adminGitHubMatch(githubUser('12345', 'joe'), { id: '999' })).toBe(null);
  });

  it('ignores user_metadata, which the user can edit', () => {
    expect(adminGitHubMatch(githubUser('1', 'joe'), { username: 'spoofed' })).toBe(null);
  });

  it('falls back to the identity login only when no id is configured', () => {
    expect(adminGitHubMatch(githubUser('1', 'Joe'), { username: 'joe' })).toBe('username');
    expect(adminGitHubMatch(githubUser('1', 'joe'), { id: '2', username: 'joe' })).toBe(null);
  });

  it('never matches without a GitHub identity or configuration', () => {
    expect(adminGitHubMatch({ identities: [] }, { id: '1' })).toBe(null);
    expect(adminGitHubMatch(githubUser('1', 'joe'), {})).toBe(null);
  });
});

describe('oauthUsername', () => {
  it('uses the provider login when it is a valid username', () => {
    expect(oauthUsername({ user_name: 'StressTestor' }, 'abcdef0123')).toBe('StressTestor');
    expect(oauthUsername({ preferred_username: 'joe_g' }, 'abcdef0123')).toBe('joe_g');
    expect(oauthUsername({ user_name: 'stress-testor' }, 'abcdef0123')).toBe('stress-testor');
  });

  it('falls back to user_<id prefix> for missing or invalid logins', () => {
    expect(oauthUsername({}, 'abcdef0123')).toBe('user_abcdef01');
    expect(oauthUsername({ user_name: 'has space' }, 'abcdef0123')).toBe('user_abcdef01');
  });
});
