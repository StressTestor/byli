import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { CREDENTIAL_OWNER_GITHUB_ID, CREDENTIAL_OWNER_USER_ID } from '@/lib/credential-owner';
const state = vi.hoisted(() => ({ user: null as any, updates: [] as any[], error: null as any, rows: [{ id: 'target', role: 'admin' }] as any[] }));
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServer: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  from: (table: string) => ({ update: (value: unknown) => {
    state.updates.push({ table, value });
    return { eq: (key: string, value: unknown) => {
      state.updates.push({ key, value });
      return { select: async () => ({ data: state.rows, error: state.error }) };
    } };
  } }),
}) }));
// Importing or using the service client is a regression: role writes must carry auth.uid().
vi.mock('@/lib/supabase-admin', () => { throw new Error('Service client forbidden in owner role endpoint'); });
import { POST } from './route';
const target = '12345678-1234-1234-1234-123456789abc';
function call(body: unknown = { id: target, role: 'admin' }, headers: Record<string, string> = {}) {
  return POST(new NextRequest('https://linkdrift.app/api/admin/roles', { method: 'POST', body: JSON.stringify(body), headers: { origin: 'https://linkdrift.app', ...headers } }));
}
beforeEach(() => {
  state.user = { id: CREDENTIAL_OWNER_USER_ID, identities: [{ provider: 'github', id: CREDENTIAL_OWNER_GITHUB_ID }] };
  state.updates = []; state.error = null; state.rows = [{ id: target, role: 'admin' }];
});
describe('owner browser role management', () => {
  it.each(['user', 'moderator', 'admin'])('lets verified owner set %s with the session client', async role => {
    const response = await call({ id: target, role });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.updates).toContainEqual({ table: 'profiles', value: expect.objectContaining({ role }) });
    expect(state.updates).toContainEqual({ key: 'id', value: target });
  });
  it('rejects anonymous and other admins even with spoofed identity data', async () => {
    for (const user of [null, { id: 'other-admin', role: 'admin', identities: [{ provider: 'github', id: 'other', identity_data: { user_name: 'StressTestor', sub: CREDENTIAL_OWNER_GITHUB_ID } }] }]) {
      state.user = user;
      expect((await call()).status).toBe(403);
    }
    expect(state.updates).toEqual([]);
  });
  it('rejects bearer auth even when owner cookies also exist', async () => {
    expect((await call(undefined, { authorization: 'Bearer ld_agent_example' })).status).toBe(403);
    expect(state.updates).toEqual([]);
  });
  it.each(['https://evil.example', 'null', ''])('rejects wrong or missing origin %s', async origin => {
    expect((await call(undefined, { origin })).status).toBe(403);
    expect(state.updates).toEqual([]);
  });
  it.each(['user', 'moderator'])('prevents owner self-demotion to %s', async role => {
    for (const id of [CREDENTIAL_OWNER_USER_ID, CREDENTIAL_OWNER_USER_ID.toUpperCase()]) {
      expect((await call({ id, role })).status).toBe(403);
    }
    expect(state.updates).toEqual([]);
  });
  it.each([{ id: '*', role: 'admin' }, { id: target, role: 'owner' }, null])('rejects invalid input %j', async body => {
    expect((await call(body)).status).toBe(400);
    expect(state.updates).toEqual([]);
  });
  it('does not claim success on DB denial', async () => {
    state.error = { message: 'sensitive' };
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('sensitive');
  });
  it('returns 404 for an absent target', async () => {
    state.rows = [];
    expect((await call()).status).toBe(404);
  });
});
