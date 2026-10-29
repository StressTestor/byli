import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
const mocks = vi.hoisted(() => ({ exchange: vi.fn(), profile: vi.fn(), cookieSet: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: mocks.cookieSet }) }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { exchangeCodeForSession: mocks.exchange }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }) }) }));
import { GET } from './route';
const request = (query = '') => new NextRequest(`https://linkdrift.app/auth/callback${query}`);
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe('email confirmation callback', () => {
  it('does not report success without a code', async () => {
    const response = await GET(request());
    expect(response.headers.get('location')).toBe('https://linkdrift.app/login?error=no_code');
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it('does not report success when the code exchange fails', async () => {
    mocks.exchange.mockResolvedValue({ data: { session: null }, error: { message: 'Expired code' } });
    const response = await GET(request('?code=test-code'));
    expect(response.headers.get('location')).toBe('https://linkdrift.app/login?error=auth_failed');
    expect(mocks.profile).not.toHaveBeenCalled();
  });
  it('requires a session even without a provider error', async () => {
    mocks.exchange.mockResolvedValue({ data: { session: null }, error: null });
    expect((await GET(request('?code=test-code'))).headers.get('location')).toBe('https://linkdrift.app/login?error=auth_failed');
  });
  it('exchanges a valid email code then sends the signed-in user home', async () => {
    mocks.exchange.mockResolvedValue({ data: { session: { user: { id: 'email-user', user_metadata: {}, identities: [{ provider: 'email', id: 'email-user' }] } } }, error: null });
    mocks.profile.mockResolvedValue({ data: { id: 'email-user', username: 'reader' } });
    const response = await GET(request('?code=test-code&next=https://evil.example'));
    expect(mocks.exchange).toHaveBeenCalledWith('test-code');
    expect(response.headers.get('location')).toBe('https://linkdrift.app/');
  });
  it('wires initial signup and resend to callback without changing password recovery', () => {
    expect(readFileSync('src/app/signup/page.tsx', 'utf8')).toContain('emailRedirectTo: `${window.location.origin}/auth/callback`');
    expect(readFileSync('src/app/auth/confirm/page.tsx', 'utf8')).toContain('emailRedirectTo: `${window.location.origin}/auth/callback`');
    expect(readFileSync('src/app/forgot/page.tsx', 'utf8')).toContain('redirectTo: `${window.location.origin}/auth/confirm`');
  });
});
