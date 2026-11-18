import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({ calls: [] as unknown[][], denied: false, auditFailure: 0, auditCount: 0, data: [{ id: 'a' }] as unknown[], error: null as unknown }));
vi.mock('@/lib/agent-auth', () => {
  class AgentAuthError extends Error { status = 401; }
  return { AgentAuthError, authenticateAgent: vi.fn(async () => {
    if (state.denied) throw new AgentAuthError();
    return { userId: 'owner', credentialId: 'credential' };
  }) };
});
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: (table: string) => {
  state.calls.push(['from', table]);
  const builder: any = {};
  for (const method of ['select', 'eq', 'order', 'range', 'update', 'insert', 'delete']) {
    builder[method] = (...args: unknown[]) => { state.calls.push([method, ...args]); return builder; };
  }
  builder.then = (resolve: (value: unknown) => void) => {
    if (table === 'admin_logs') { state.auditCount++; return resolve({ data: [], error: state.auditCount === state.auditFailure ? { message: 'audit unavailable' } : null }); }
    return resolve({ data: state.data, error: state.error });
  };
  return builder;
} } }));
import { POST } from './route';
const id = '12345678-1234-1234-1234-123456789abc';
const call = (body: unknown) => POST(new NextRequest('https://linkdrift.app/api/agent/admin', { method: 'POST', body: JSON.stringify(body), headers: { authorization: 'Bearer test' } }));
beforeEach(() => { state.calls = []; state.auditCount = 0; state.auditFailure = 0; state.denied = false; state.data = [{ id }]; state.error = null; });
describe('agent admin dispatcher', () => {
  it('does not touch database when credential is rejected', async () => {
    state.denied = true;
    expect((await call({ operation: 'list.profiles' })).status).toBe(401);
    expect(state.calls).toEqual([]);
  });
  it.each(['list.agent_credentials', 'sql', '__proto__', 'constructor'])('rejects unlisted operation %s', async operation => {
    expect((await call({ operation })).status).toBe(400);
    expect(state.calls).toEqual([]);
  });
  it.each([{ limit: 101 }, { limit: 0 }, { offset: -1 }, { offset: 1.5 }])('bounds reads %j', async paging => {
    expect((await call({ operation: 'list.articles', ...paging })).status).toBe(400);
    expect(state.calls).toEqual([]);
  });
  it('orders and bounds paginated results', async () => {
    const response = await call({ operation: 'list.articles', offset: 100, limit: 20 });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.calls).toContainEqual(['range', 100, 119]);
    expect(state.calls).toContainEqual(['order', 'id', { ascending: true }]);
  });
  it('rejects invalid identifiers and values before mutation', async () => {
    expect((await call({ operation: 'article.delete', id: '*' })).status).toBe(400);
    expect((await call({ operation: 'article.feature', id, featured: 'true' })).status).toBe(400);
    expect((await call({ operation: 'setting.update', key: 'arbitrary', value: true })).status).toBe(400);
    expect(state.calls).toEqual([]);
  });
  it('rejects only pending submissions and attributes review to credential owner', async () => {
    expect((await call({ operation: 'submission.reject', id })).status).toBe(200);
    expect(state.calls).toContainEqual(['eq', 'id', id]);
    expect(state.calls).toContainEqual(['eq', 'status', 'pending']);
    expect(state.calls).toContainEqual(['update', expect.objectContaining({ status: 'rejected', reviewed_by: 'owner' })]);
  });
  it.each([
    { operation: 'article.feature', id, featured: true },
    { operation: 'article.status', id, status: 'archived' },
    { operation: 'article.delete', id },
    { operation: 'setting.update', key: 'signup_enabled', value: false },
    { operation: 'seed.create', handle: 'example_author', status: 'approved' },
    { operation: 'seed.update', id, status: 'rejected', high_yield: false },
    { operation: 'seed.delete', id },
  ])('accepts supported validated mutation $operation', async input => {
    expect((await call(input)).status).toBe(200);
  });
  it.each([
    { operation: 'article.status', id, status: 'admin' },
    { operation: 'seed.create', handle: '@invalid', status: 'approved' },
    { operation: 'seed.create', handle: 'valid', status: 'admin' },
    { operation: 'seed.update', id, status: 'approved', high_yield: 1 },
  ])('rejects invalid mutation fields $operation', async input => {
    expect((await call(input)).status).toBe(400);
    expect(state.calls).toEqual([]);
  });
  it('records target attempt before mutation and correlated success afterwards', async () => {
    const response = await call({ operation: 'article.delete', id });
    expect(await response.json()).toMatchObject({ ok: true, auditRecorded: true });
    const attempts = state.calls.filter(c => c[0] === 'insert').map(c => c[1] as any);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ action: 'agent_operation_attempt', target_type: 'article', target_id: id });
    expect(attempts[1]).toMatchObject({ action: 'agent_operation_succeeded', metadata: { attempt_id: attempts[0].metadata.attempt_id } });
    expect(state.calls.findIndex(c => c[0] === 'insert')).toBeLessThan(state.calls.findIndex(c => c[0] === 'delete'));
  });
  it('fails closed before mutation when attempt audit fails', async () => {
    state.auditFailure = 1;
    expect((await call({ operation: 'article.delete', id })).status).toBe(503);
    expect(state.calls).not.toContainEqual(['from', 'articles']);
  });
  it('does not invite retry after successful mutation with failed outcome audit', async () => {
    state.auditFailure = 2;
    const response = await call({ operation: 'article.delete', id });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, auditRecorded: false });
  });
  it('records failed result without exposing database details', async () => {
    state.error = { message: 'private' };
    expect((await call({ operation: 'article.delete', id })).status).toBe(500);
    expect(state.calls).toContainEqual(['insert', expect.objectContaining({ action: 'agent_operation_failed' })]);
  });
  it('records no-match rather than falsely recording success', async () => {
    state.data = [];
    expect((await call({ operation: 'submission.reject', id })).status).toBe(409);
    expect(state.calls).toContainEqual(['insert', expect.objectContaining({ action: 'agent_operation_no_match' })]);
  });
  it('reports stale/missing targets', async () => {
    state.data = [];
    expect((await call({ operation: 'article.delete', id })).status).toBe(409);
  });
  it('does not expose database errors', async () => {
    state.error = { message: 'sensitive database detail' };
    const response = await call({ operation: 'list.profiles' });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('sensitive');
  });
  it('bounds streamed request bytes', async () => {
    expect((await call({ operation: 'list.profiles', padding: 'x'.repeat(9000) })).status).toBe(400);
    expect(state.calls).toEqual([]);
  });
});
