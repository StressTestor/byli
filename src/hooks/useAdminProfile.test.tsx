import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const state = vi.hoisted(() => ({
  auth: { user: null as { id: string } | null, loading: false },
  pending: new Map<string, (value: any) => void>(),
}));
vi.mock('@/hooks/api', () => ({ useAuth: () => state.auth }));
vi.mock('@/lib/supabase-browser', () => ({ createBrowserClient: () => ({
  from: () => ({ select: () => ({ eq: (_: string, id: string) => ({
    single: () => new Promise(resolve => { state.pending.set(id, resolve); }),
  }) }) }),
}) }));
import { useAdminProfile } from './useAdminProfile';
let last: ReturnType<typeof useAdminProfile>;
function Harness() { last = useAdminProfile(); return null; }
let view: ReactTestRenderer;
async function render(user: string | null, loading = false) {
  state.auth = { user: user ? { id: user } : null, loading };
  await act(async () => { if (view) view.update(<Harness />); else view = create(<Harness />); });
}
async function resolve(id: string, role: string) {
  await act(async () => { state.pending.get(id)!({ data: { id, role } }); });
}
beforeEach(() => { view?.unmount(); view = undefined as any; state.pending.clear(); state.auth = { user: null, loading: false }; });

describe('admin UI session state', () => {
  it('clears admin state immediately after logout', async () => {
    await render('admin'); await resolve('admin', 'admin'); expect(last.isAdmin).toBe(true);
    await render(null); expect(last.isAdmin).toBe(false); expect(last.profile).toBeNull(); expect(last.loading).toBe(false);
  });
  it('never displays prior admin privileges during another user lookup', async () => {
    await render('admin'); await resolve('admin', 'admin');
    await render('member'); expect(last.isAdmin).toBe(false); expect(last.loading).toBe(true);
    await resolve('member', 'user'); expect(last.isAdmin).toBe(false); expect(last.loading).toBe(false);
  });
  it('discards an older admin response after account switch', async () => {
    await render('admin'); await render('member'); await resolve('member', 'user'); await resolve('admin', 'admin');
    expect(last.isAdmin).toBe(false); expect(last.profile?.id).toBe('member');
  });
  it('discards in-flight role responses after signout', async () => {
    await render('admin'); await render(null); await resolve('admin', 'admin');
    expect(last.isAdmin).toBe(false); expect(last.profile).toBeNull();
  });
  it('hides role information while authentication refresh is pending', async () => {
    await render('admin'); await resolve('admin', 'admin'); await render('admin', true);
    expect(last.isAdmin).toBe(false); expect(last.loading).toBe(true);
  });
});
