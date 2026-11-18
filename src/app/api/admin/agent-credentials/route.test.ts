import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({
  user: null as any, admin: true, principalRole: 'admin',
  agentData: [] as unknown[], agentError: null as unknown, auditError: null as unknown,
  calls: [] as unknown[][],
}));
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServer: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user } }) },
  rpc: async () => ({ data: state.admin, error: null }),
}) }));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: (table: string) => {
  const q: any = {};
  for (const method of ['select', 'eq', 'maybeSingle', 'insert']) q[method] = (...args: unknown[]) => {
    state.calls.push(['admin', table, method, ...args]); return q;
  };
  q.then = (resolve: (value: unknown) => void) => resolve(table === 'profiles'
    ? { data: { role: state.principalRole }, error: null }
    : { data: null, error: state.auditError });
  return q;
} } }));
vi.mock('@/lib/agent-auth', async () => {
  const { createHash, randomBytes } = await import('node:crypto');
  return {
    newAgentSecret: () => `ld_agent_${randomBytes(32).toString('base64url')}`,
    hashAgentSecret: (token: string) => createHash('sha256').update(token).digest('hex'),
    agentDb: { from: (table: string) => {
      const q: any = {};
      for (const method of ['select', 'order', 'limit', 'range', 'insert', 'update', 'eq']) q[method] = (...args: unknown[]) => {
        state.calls.push(['agent', table, method, ...args]); return q;
      };
      q.then = (resolve: (value: unknown) => void) => resolve({ data: state.agentData, error: state.agentError });
      return q;
    } },
  };
});
import { CREDENTIAL_OWNER_USER_ID, CREDENTIAL_OWNER_GITHUB_ID } from '@/lib/credential-owner';
import { GET, POST, DELETE } from './route';
const credentialId = '12345678-1234-1234-1234-123456789abc';
const otherAdminId = 'abcdefab-1234-1234-1234-123456789abc';
const validBody = { label: 'Research agent', expiresInDays: 30 };
function request(method: string, body?: unknown, origin: string | null = 'https://linkdrift.app', authorization?: string) {
  const headers: Record<string, string> = {};
  if (origin) headers.origin = origin;
  if (authorization) headers.authorization = authorization;
  return new NextRequest('https://linkdrift.app/api/admin/agent-credentials', {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  state.user = { id: CREDENTIAL_OWNER_USER_ID, identities: [{ provider: 'github', id: CREDENTIAL_OWNER_GITHUB_ID }] };
  state.admin = true; state.principalRole = 'admin'; state.agentData = []; state.agentError = null; state.auditError = null; state.calls = [];
});
describe('owner-only credential lifecycle', () => {
  it.each(['POST', 'DELETE', 'GET'])('denies a different browser admin %s', async method => {
    state.user = { id: otherAdminId, identities: [{ provider: 'github', id: '999', identity_data: { user_name: 'StressTestor' } }] };
    const handler = { POST, DELETE, GET }[method]!;
    expect((await handler(request(method, method === 'GET' ? undefined : { ...validBody, id: credentialId }))).status).toBe(403);
    expect(state.calls).toEqual([]);
  });
  it.each(['POST', 'DELETE'])('denies bearer-only lifecycle %s even when key is admin-scoped', async method => {
    state.user = null;
    const handler = method === 'POST' ? POST : DELETE;
    expect((await handler(request(method, { ...validBody, id: credentialId }, 'https://linkdrift.app', 'Bearer ld_agent_'+'A'.repeat(43)))).status).toBe(403);
    expect(state.calls).toEqual([]);
  });
  it('requires both immutable owner account and GitHub identity', async () => {
    state.user.identities[0].id = 'other-provider-id';
    expect((await POST(request('POST', validBody))).status).toBe(403);
    state.user.id = otherAdminId; state.user.identities[0].id = CREDENTIAL_OWNER_GITHUB_ID;
    expect((await POST(request('POST', validBody))).status).toBe(403);
    expect(state.calls).toEqual([]);
  });
  it('fails closed when owner is no longer an admin', async () => {
    state.admin = false;
    expect((await POST(request('POST', validBody))).status).toBe(403);
  });
  it.each([null, 'https://attacker.example'])('denies mutation without same-origin browser request %s', async origin => {
    expect((await POST(request('POST', validBody, origin))).status).toBe(403);
    expect((await DELETE(request('DELETE', { id: credentialId }, origin))).status).toBe(403);
    expect(state.calls).toEqual([]);
  });
  it('lists credentials without selecting their hashes, bounded and non-cacheable', async () => {
    state.agentData = [{ id: credentialId, label: 'Other admin agent' }];
    const result = await GET(request('GET'));
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(await result.json()).toEqual({ credentials: state.agentData, offset:0, nextOffset:null });
    expect(state.calls).toContainEqual(['agent', 'agent_credentials', 'range', 0, 99]);
    const select = state.calls.find(c => c[2] === 'select')!;
    expect(select[3]).not.toContain('secret_hash');
  });
  it.each([1, 90])('issues an expiring secret at allowed boundary %i days and stores only hash', async expiresInDays => {
    const before = Date.now();
    const result = await POST(request('POST', { ...validBody, expiresInDays }));
    expect(result.status).toBe(201);
    expect(result.headers.get('cache-control')).toBe('no-store');
    const body = await result.json();
    expect(body.token).toMatch(/^ld_agent_[A-Za-z0-9_-]{43}$/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThanOrEqual(before + expiresInDays*86400000);
    const stored = state.calls.find(c => c[0] === 'agent' && c[2] === 'insert')![3] as Record<string, unknown>;
    expect(stored.secret_hash).toBe(createHash('sha256').update(body.token).digest('hex'));
    expect(stored.owner_id).toBe(CREDENTIAL_OWNER_USER_ID);
    expect(JSON.stringify(state.calls)).not.toContain(body.token);
  });
  it.each([0, 91, 1.5, '30', null])('rejects invalid expiry %s', async expiresInDays => {
    expect((await POST(request('POST', { ...validBody, expiresInDays }))).status).toBe(400);
    expect(state.calls).toEqual([]);
  });
  it('allows the owner to issue credentials for another current admin', async () => {
    expect((await POST(request('POST', { ...validBody, adminUserId: otherAdminId }))).status).toBe(201);
    expect(state.calls).toContainEqual(['admin', 'profiles', 'eq', 'id', otherAdminId]);
    expect(state.calls).toContainEqual(['agent', 'agent_credentials', 'insert', expect.objectContaining({ owner_id: otherAdminId })]);
  });
  it('refuses issuing an admin token for a non-admin principal', async () => {
    state.principalRole = 'user';
    expect((await POST(request('POST', { ...validBody, adminUserId: otherAdminId }))).status).toBe(400);
    expect(state.calls.some(c => c[0] === 'agent')).toBe(false);
  });
  it('does not create credentials if audit service fails', async () => {
    state.auditError = { message: 'unavailable' };
    expect((await POST(request('POST', validBody))).status).toBe(503);
    expect(state.calls.some(c => c[0] === 'agent')).toBe(false);
  });
  it('does not disclose a secret after failed storage', async () => {
    state.agentError = { message: 'unavailable' };
    const result = await POST(request('POST', validBody));
    expect(result.status).toBe(503);
    expect(await result.json()).not.toHaveProperty('token');
  });
  it('lets owner revoke another admin credential, not just their own', async () => {
    state.agentData = [{ id: credentialId }];
    const result = await DELETE(request('DELETE', { id: credentialId }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ revoked: true, auditRecorded: true });
    expect(state.calls).toContainEqual(['agent', 'agent_credentials', 'eq', 'id', credentialId]);
    expect(state.calls.some(c => c[2] === 'eq' && c[3] === 'owner_id')).toBe(false);
  });
  it('retains revocation even when audit fails and reports the gap', async () => {
    state.agentData = [{ id: credentialId }]; state.auditError = { message: 'down' };
    const result = await DELETE(request('DELETE', { id: credentialId }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ revoked: true, auditRecorded: false });
  });
});

it('rejects streamed credential bodies over 8KiB without issuing a key', async () => {
  const result = await POST(request('POST', { ...validBody, padding: 'x'.repeat(8192) }));
  expect(result.status).toBe(400);
  expect(state.calls.some(call => call[0] === 'agent' && call[2] === 'insert')).toBe(false);
});

it('pages metadata beyond the first hundred with stable ordering', async () => {
  state.agentData = Array.from({ length: 100 }, (_, i) => ({ id: `key-${i}` }));
  const response = await GET(new NextRequest('https://linkdrift.app/api/admin/agent-credentials?offset=100'));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ offset: 100, nextOffset: 200 });
  expect(state.calls).toContainEqual(['agent','agent_credentials','range',100,199]);
  expect(state.calls).toContainEqual(['agent','agent_credentials','order','id',{ascending:false}]);
});
it.each(['-1','1.5','Infinity','100001'])('rejects invalid list offset %s', async offset => {
  expect((await GET(new NextRequest(`https://linkdrift.app/api/admin/agent-credentials?offset=${offset}`))).status).toBe(400);
});

describe('owner-selected credential scope', () => {
  it.each([
    { scope: undefined, expected: 'admin' },
    { scope: 'admin', expected: 'admin' },
    { scope: 'submission_review', expected: 'submission_review' },
  ])('persists, audits and returns scope $expected with explicit input $scope', async ({ scope, expected }) => {
    const result = await POST(request('POST', { ...validBody, scope }));
    expect(result.status).toBe(201);
    expect((await result.json()).scope).toBe(expected);
    expect(state.calls).toContainEqual(['agent', 'agent_credentials', 'insert', expect.objectContaining({ scope: expected })]);
    expect(state.calls).toContainEqual(['admin', 'admin_logs', 'insert', expect.objectContaining({
      action: 'agent_credential_issue_requested', metadata: expect.objectContaining({ scope: expected }),
    })]);
  });
  it.each(['', 'ADMIN', 'admin ', 'root', 'submission-review', null, false, 0, [], ['admin'], { scope: 'admin' }])('rejects unknown or malformed scope %j before touching storage', async scope => {
    const result = await POST(request('POST', { ...validBody, scope }));
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: 'scope must be admin or submission_review' });
    expect(state.calls).toEqual([]);
  });
  it('requires owner authorization even for restricted submission-review issuance', async () => {
    state.user = { id: otherAdminId, identities: [{ provider: 'github', id: '999' }] };
    expect((await POST(request('POST', { ...validBody, scope: 'submission_review' }))).status).toBe(403);
    expect(state.calls).toEqual([]);
  });
});
