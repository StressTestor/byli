import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  user: { id: 'admin-1' } as any,
  isAdmin: true,
  agent: false,
  audits: [] as any[],
  auditFailureAt: 0,
  claimError: false,
  linkError: false,
  linkNoMatch: false,
  releaseError: false,
  categoryError: false,
  events: [] as string[],
  submission: { id: 's1', url: 'https://x.com/a/status/2027172169336476151', status: 'pending', category_id: 'c1' } as any,
  updates: [] as any[],
  updateFilters: [] as any[],
  lostRace: false,
  upserts: [] as any[],
  ingest: vi.fn(),
}));

vi.mock('@/lib/agent-auth', () => {
  class AgentAuthError extends Error { status = 401; }
  return { AgentAuthError, authenticateAgent: async () => { if (!state.agent) throw new AgentAuthError(); return {userId:'other-admin',credentialId:'key'}; } };
});
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: state.isAdmin, error: null }),
  }),
}));

vi.mock('@/lib/supabase-admin', () => {
  const from = (table: string) => {
    const b: any = {};
    b.insert = async (row: any) => {
      state.audits.push(row); state.events.push(row.action);
      return { error: state.audits.length === state.auditFailureAt ? { message: 'unavailable' } : null };
    };
    b.select = () => b;
    b.eq = () => b;
    b.maybeSingle = async () => ({ data: state.submission, error: null });
    b.update = (row: any) => {
      state.updates.push({ table, row }); state.events.push('update');
      const u: any = {};
      u.eq = (col: string, val: unknown) => { state.updateFilters.push([col, val]); return u; };
      u.is = (col: string, val: unknown) => { state.updateFilters.push([col, val]); return u; };
      u.then = (resolve: (v: unknown) => void) => resolve({ error: (row.article_id ? state.linkError : state.releaseError) ? { message: 'failed' } : null });
      u.select = async () => row.article_id
        ? { data: state.linkNoMatch ? [] : [{ id: 's1' }], error: state.linkError ? { message: 'link error' } : null }
        : { data: state.lostRace ? [] : [{ id: 's1' }], error: state.claimError ? { message: 'claim error' } : null };
      return u;
    };
    b.upsert = async (row: any) => { state.upserts.push({ table, row }); return { error: state.categoryError ? { message: 'category failed' } : null }; };
    return b;
  };
  return { supabaseAdmin: { from } };
});

vi.mock('@/lib/ingest', () => ({ ingestSingleArticle: (...a: any[]) => state.ingest(...a) }));

import { POST } from './route';

const call = () => POST({headers: new Headers()} as any, { params: Promise.resolve({ id: 's1' }) });

beforeEach(() => {
  state.user = { id: 'admin-1' };
  state.isAdmin = true;
  state.agent = false;
  state.audits = []; state.auditFailureAt = 0; state.claimError = false; state.linkError = false; state.linkNoMatch = false; state.releaseError = false; state.categoryError = false; state.events = [];
  state.submission = { id: 's1', url: 'https://x.com/a/status/2027172169336476151', status: 'pending', category_id: 'c1' };
  state.updates = [];
  state.updateFilters = [];
  state.lostRace = false;
  state.upserts = [];
  state.ingest = vi.fn(async () => ({ ok: true, articleId: 'art-1' }));
});

describe('approve submission route', () => {
  it('rejects anonymous and non-admin callers before touching data', async () => {
    state.user = null;
    expect((await call()).status).toBe(401);
    state.user = { id: 'u' };
    state.isAdmin = false;
    expect((await call()).status).toBe(403);
    expect(state.ingest).not.toHaveBeenCalled();
    expect(state.updates).toEqual([]);
  });

  it('ingests by tweet id and links the article to the submission', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(state.ingest).toHaveBeenCalledWith('2027172169336476151');
    expect(state.upserts[0]).toMatchObject({ table: 'article_categories', row: { article_id: 'art-1', category_id: 'c1' } });
    // Claim first, then link the article once it exists.
    expect(state.updates[0]).toMatchObject({
      table: 'submissions',
      row: { status: 'approved', reviewed_by: 'admin-1' },
    });
    expect(state.updates[1]).toMatchObject({ table: 'submissions', row: { article_id: 'art-1' } });
  });

  it('links an article that already exists', async () => {
    state.ingest = vi.fn(async () => ({ ok: false, error: 'already exists', articleId: 'old-1' }));
    const res = await call();
    expect(res.status).toBe(200);
    expect(state.updates[1].row.article_id).toBe('old-1');
  });

  it('puts the submission back in the queue when ingest fails', async () => {
    state.ingest = vi.fn(async () => ({ ok: false, error: 'not an article or article not found' }));
    expect((await call()).status).toBe(502);
    expect(state.updates.map((u) => u.row.status)).toEqual(['approved', 'pending']);
    expect(state.updateFilters).toContainEqual(['article_id', null]);
  });

  it('refuses non-status URLs and already-reviewed submissions', async () => {
    state.submission.url = 'https://x.com/i/article/123456789';
    expect((await call()).status).toBe(422);
    state.submission = { ...state.submission, url: 'https://x.com/a/status/2027172169336476151', status: 'approved' };
    expect((await call()).status).toBe(409);
    expect(state.ingest).not.toHaveBeenCalled();
  });

  it('claims only a submission that is still pending, before ingesting', async () => {
    expect((await call()).status).toBe(200);
    expect(state.updateFilters).toContainEqual(['status', 'pending']);

    state.lostRace = true;
    state.ingest.mockClear();
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/someone else/);
    expect(state.ingest).not.toHaveBeenCalled();
  });
});

it('accepts valid admin bearer independently of browser session', async () => {
  state.user = null; state.agent = true;
  const response = await POST({headers:new Headers({authorization:'Bearer agent'})} as any, {params:Promise.resolve({id:'s1'})});
  expect(response.status).toBe(200);
  expect(state.updates[0].row.reviewed_by).toBe('other-admin');
});
it('does not fall back to owner cookies for an invalid bearer', async () => {
  const response = await POST({headers:new Headers({authorization:'Bearer invalid'})} as any, {params:Promise.resolve({id:'s1'})});
  expect(response.status).toBe(401); expect(state.ingest).not.toHaveBeenCalled();
});

const agentCall = () => {
  state.agent = true;
  return POST({ headers: new Headers({ authorization: 'Bearer agent' }) } as any, { params: Promise.resolve({ id: 's1' }) });
};
describe('bearer approval attribution', () => {
  it('logs target/credential attempt before mutation and correlated success afterwards', async () => {
    const response = await agentCall();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, auditRecorded: true });
    expect(state.audits).toHaveLength(2);
    expect(state.audits[0]).toMatchObject({ admin_id: 'other-admin', action: 'agent_approval_attempt', target_type: 'submission', target_id: 's1', metadata: { credential_id: 'key', operation: 'approve_submission' } });
    expect(state.audits[1]).toMatchObject({ action: 'agent_approval_succeeded', metadata: { attempt_id: state.audits[0].metadata.attempt_id, article_id: 'art-1', stage: 'complete' } });
    expect(state.events[0]).toBe('agent_approval_attempt');
    expect(JSON.stringify(state.audits)).not.toContain('Bearer');
    expect(JSON.stringify(state.audits)).not.toContain(state.submission.url);
  });
  it('fails closed if the durable attempt cannot be written', async () => {
    state.auditFailureAt = 1;
    expect((await agentCall()).status).toBe(503);
    expect(state.updates).toEqual([]);
    expect(state.ingest).not.toHaveBeenCalled();
  });
  it('does not misreport a completed approval when outcome audit fails', async () => {
    state.auditFailureAt = 2;
    const response = await agentCall();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, auditRecorded: false });
  });
  it('records a lost pending-claim race as no match, not success', async () => {
    state.lostRace = true;
    expect((await agentCall()).status).toBe(409);
    expect(state.audits[1].action).toBe('agent_approval_no_match');
    expect(state.ingest).not.toHaveBeenCalled();
  });
  it('records an ingestion exception as unknown with stage retained', async () => {
    state.ingest = vi.fn(async () => { throw new Error('private upstream detail'); });
    const response = await agentCall();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private upstream detail');
    expect(state.audits[1]).toMatchObject({ action: 'agent_approval_unknown', metadata: { stage: 'ingest' } });
  });
  it('records article-created/link-failed as partial', async () => {
    state.linkError = true;
    expect((await agentCall()).status).toBe(500);
    expect(state.audits[1]).toMatchObject({ action: 'agent_approval_partial', metadata: { stage: 'link', article_id: 'art-1' } });
  });
  it('does not claim success when final link matched no submission', async () => {
    state.linkNoMatch = true;
    const response = await agentCall();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('disappeared') });
    expect(state.audits[1]).toMatchObject({ action: 'agent_approval_partial', metadata: { stage: 'link', article_id: 'art-1' } });
  });
  it('records category failure honestly even though approval returns success', async () => {
    state.categoryError = true;
    expect((await agentCall()).status).toBe(200);
    expect(state.audits[1]).toMatchObject({ action: 'agent_approval_partial', metadata: { category_link_failed: true } });
  });
  it('distinguishes successful release request from failed release after ingestion failure', async () => {
    state.ingest = vi.fn(async () => ({ ok: false, error: 'ingest failed' }));
    expect((await agentCall()).status).toBe(502);
    expect(state.audits[1]).toMatchObject({ action: 'agent_approval_failed', metadata: { release_request_succeeded: true } });
    state.audits = []; state.releaseError = true;
    expect((await agentCall()).status).toBe(502);
    expect(state.audits[1]).toMatchObject({ action: 'agent_approval_partial', metadata: { release_request_succeeded: false } });
  });
  it('keeps browser behavior independent of bearer audit availability', async () => {
    state.auditFailureAt = 1;
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('auditRecorded');
    expect(state.audits).toEqual([]);
  });
});

it('never links a blocked ingest outcome even if it incorrectly includes a legacy article ID', async () => {
  state.ingest = vi.fn(async () => ({ ok: false, blocked: true, error: 'crypto-airdrop promotion is not allowed', articleId: 'legacy-blocked' }));
  const response = await call();
  expect(response.status).toBe(422);
  expect(state.updates.map(u => u.row.status)).toEqual(['approved', 'pending']);
  expect(state.updates.some(u => u.row.article_id)).toBe(false);
  expect(state.upserts).toEqual([]);
});
