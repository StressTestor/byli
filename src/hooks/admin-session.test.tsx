import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const state = vi.hoisted(() => ({
  resolveSession: null as null | ((value: any) => void),
  authEvent: null as null | ((event: string, session: any) => void),
  profiles: [] as string[],
  unsubscribe: vi.fn(),
}));
vi.mock('@/lib/supabase-browser', () => ({ createBrowserClient: () => ({
  auth: {
    getSession: () => new Promise(resolve => { state.resolveSession = resolve; }),
    onAuthStateChange: (callback: any) => { state.authEvent = callback; return { data: { subscription: { unsubscribe: state.unsubscribe } } }; },
  },
  from: () => ({ select: () => ({ eq: (_: string, id: string) => ({ single: async () => {
    state.profiles.push(id); return { data: { id, role: id === 'admin' ? 'admin' : 'user' } };
  } }) }) }),
}) }));
import { useAdminProfile } from './useAdminProfile';
let latest: ReturnType<typeof useAdminProfile>;
function Harness() { latest = useAdminProfile(); return null; }
let view: ReactTestRenderer;
beforeEach(async () => { await act(async () => { view?.unmount(); }); state.profiles = []; state.unsubscribe.mockClear(); });
async function mount() { await act(async () => { view = create(<Harness />); }); }
async function initial(id: string) { await act(async () => { state.resolveSession!({ data: { session: { user: { id } } } }); }); }
async function event(id: string | null) { await act(async () => { state.authEvent!(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null); }); }

describe('actual auth and admin hooks together', () => {
  it('ignores initial admin session resolved after a newer sign-out', async () => {
    await mount(); await event(null); await initial('admin');
    expect(latest.user).toBeNull(); expect(latest.isAdmin).toBe(false); expect(latest.loading).toBe(false);
    expect(state.profiles).not.toContain('admin');
  });
  it('ignores initial admin session resolved after switching to a member', async () => {
    await mount(); await event('member'); await initial('admin');
    expect(latest.user.id).toBe('member'); expect(latest.isAdmin).toBe(false); expect(latest.loading).toBe(false);
    expect(state.profiles).toEqual(['member']);
  });
  it('still loads an ordinary initial admin session', async () => {
    await mount(); await initial('admin'); expect(latest.isAdmin).toBe(true);
  });
  it('cleans up before a late initial-session response', async () => {
    await mount(); await act(async () => { view.unmount(); }); await initial('admin');
    expect(state.unsubscribe).toHaveBeenCalledOnce(); expect(state.profiles).toEqual([]);
  });
});
