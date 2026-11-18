import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';

// Exercise the real shared authentication gate, not a mocked authorization result.
// Only external persistence, browser sessions and ingestion are synthetic.
const state = vi.hoisted(() => ({
  scope: 'submission_review', calls: [] as unknown[][],
  browser: vi.fn(), runIngestion: vi.fn(), ingestSingleArticle: vi.fn(), sleep: vi.fn(),
}));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: (table: string) => {
  state.calls.push(['from', table]);
  if (table !== 'agent_credentials') throw new Error(`Unexpected protected data access: ${table}`);
  const query: any = {};
  for (const method of ['select', 'eq', 'is', 'gt', 'maybeSingle']) query[method] = (...args: unknown[]) => {
    state.calls.push([method, ...args]); return query;
  };
  query.then = (resolve: (value: unknown) => void) => resolve({
    data: { id: 'credential-id', owner_id: 'admin-id', scope: state.scope }, error: null,
  });
  return query;
} } }));
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServer: state.browser }));
vi.mock('@/lib/ingest', () => ({
  runIngestion: state.runIngestion, ingestSingleArticle: state.ingestSingleArticle, sleep: state.sleep,
}));
import { POST as dispatch } from '@/app/api/agent/admin/route';
import { GET as ingestGet, POST as ingestPost } from '@/app/api/ingest/route';
import { GET as listKeys, POST as issueKey, DELETE as revokeKey } from '@/app/api/admin/agent-credentials/route';
import { POST as changeRole } from '@/app/api/admin/roles/route';

const token = `ld_agent_${'T'.repeat(43)}`;
const id = '12345678-1234-1234-1234-123456789abc';
function request(path: string, method: string, body?: unknown) {
  return new NextRequest(`https://linkdrift.app${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, origin: 'https://linkdrift.app', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  state.scope = 'submission_review'; state.calls = [];
  state.browser.mockReset(); state.runIngestion.mockReset(); state.ingestSingleArticle.mockReset(); state.sleep.mockReset();
  // An otherwise-valid browser owner must never turn a bearer lifecycle call
  // into an authorized owner mutation. The handler must reject before lookup.
  state.browser.mockImplementation(() => { throw new Error('Unexpected browser auth fallback'); });
  vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret-not-an-agent-token');
});
afterEach(() => vi.unstubAllEnvs());

const privilegedOperations = [
  'list.articles', 'list.profiles', 'list.settings', 'list.health', 'list.logs',
  'list.seeds', 'list.categories', 'list.authors', 'article.feature',
  'article.status', 'article.delete', 'setting.update', 'health.run',
  'profile.role', 'seed.create', 'seed.update', 'seed.delete',
];
describe('restricted scope through real API entrypoints', () => {
  it.each(privilegedOperations)('denies submission_review on %s before touching protected data', async operation => {
    const result = await dispatch(request('/api/agent/admin', 'POST', {
      operation, id, featured: true, status: 'approved', key: 'signup_enabled', value: false,
      role: 'admin', handle: 'example_author', limit: 1,
    }));
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ error: 'Unauthorized' });
    expect(state.calls.filter(call => call[0] === 'from')).toEqual([['from', 'agent_credentials']]);
    expect(state.calls).toContainEqual(['eq', 'secret_hash', createHash('sha256').update(token).digest('hex')]);
    expect(state.browser).not.toHaveBeenCalled();
    expect(state.runIngestion).not.toHaveBeenCalled();
    expect(state.ingestSingleArticle).not.toHaveBeenCalled();
  });
  it.each(['GET', 'POST'])('denies ingestion %s with restricted credential before ingestion or request-body work', async method => {
    const req = request('/api/ingest', method, method === 'POST' ? { tweet_id: '123456789' } : undefined);
    const bodySpy = vi.spyOn(req, 'json');
    const result = await (method === 'GET' ? ingestGet : ingestPost)(req);
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ error: 'Operation outside credential scope' });
    expect(state.runIngestion).not.toHaveBeenCalled();
    expect(state.ingestSingleArticle).not.toHaveBeenCalled();
    expect(state.sleep).not.toHaveBeenCalled();
    expect(bodySpy).not.toHaveBeenCalled();
    expect(state.calls.filter(call => call[0] === 'from')).toEqual([['from', 'agent_credentials']]);
  });
  it('rejects unrecognized stored scopes on a normally permitted review operation', async () => {
    state.scope = 'submission_review_plus';
    const result = await dispatch(request('/api/agent/admin', 'POST', { operation: 'list.submissions' }));
    expect(result.status).toBe(401);
    expect(state.calls.filter(call => call[0] === 'from')).toEqual([['from', 'agent_credentials']]);
  });
});

describe.each(['submission_review', 'admin'])('%s bearer credentials cannot access browser-owner lifecycle', scope => {
  it.each([
    { name: 'list', method: 'GET', path: '/api/admin/agent-credentials', handler: listKeys, body: undefined },
    { name: 'issue', method: 'POST', path: '/api/admin/agent-credentials', handler: issueKey, body: { label: 'Agent', expiresInDays: 30, scope: 'admin' } },
    { name: 'revoke', method: 'DELETE', path: '/api/admin/agent-credentials', handler: revokeKey, body: { id } },
    { name: 'role elevation', method: 'POST', path: '/api/admin/roles', handler: changeRole, body: { id, role: 'admin' } },
  ])('denies $name without browser fallback or database calls', async ({ method, path, handler, body }) => {
    state.scope = scope;
    const result = await handler(request(path, method, body));
    expect(result.status).toBe(403);
    expect(state.calls).toEqual([]);
    expect(state.browser).not.toHaveBeenCalled();
  });
});
