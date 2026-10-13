import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  user: { id: 'admin-1' } as any,
  isAdmin: true,
  submission: { id: 's1', url: 'https://x.com/a/status/2027172169336476151', status: 'pending', category_id: 'c1' } as any,
  updates: [] as any[],
  updateFilters: [] as any[],
  lostRace: false,
  upserts: [] as any[],
  ingest: vi.fn(),
}));

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: state.isAdmin, error: null }),
  }),
}));

vi.mock('@/lib/supabase-admin', () => {
  const from = (table: string) => {
    const b: any = {};
    b.select = () => b;
    b.eq = () => b;
    b.maybeSingle = async () => ({ data: state.submission, error: null });
    b.update = (row: any) => {
      state.updates.push({ table, row });
      const u: any = {};
      u.eq = (col: string, val: unknown) => { state.updateFilters.push([col, val]); return u; };
      u.select = async () => ({ data: state.lostRace ? [] : [{ id: 's1' }], error: null });
      return u;
    };
    b.upsert = async (row: any) => { state.upserts.push({ table, row }); return { error: null }; };
    return b;
  };
  return { supabaseAdmin: { from } };
});

vi.mock('@/lib/ingest', () => ({ ingestSingleArticle: (...a: any[]) => state.ingest(...a) }));

import { POST } from './route';

const call = () => POST({} as any, { params: Promise.resolve({ id: 's1' }) });

beforeEach(() => {
  state.user = { id: 'admin-1' };
  state.isAdmin = true;
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
    expect(state.updates[0]).toMatchObject({
      table: 'submissions',
      row: { status: 'approved', article_id: 'art-1', reviewed_by: 'admin-1' },
    });
  });

  it('links an article that already exists', async () => {
    state.ingest = vi.fn(async () => ({ ok: false, error: 'already exists', articleId: 'old-1' }));
    const res = await call();
    expect(res.status).toBe(200);
    expect(state.updates[0].row.article_id).toBe('old-1');
  });

  it('does not mark approved when ingest fails', async () => {
    state.ingest = vi.fn(async () => ({ ok: false, error: 'not an article or article not found' }));
    expect((await call()).status).toBe(502);
    expect(state.updates).toEqual([]);
  });

  it('refuses non-status URLs and already-reviewed submissions', async () => {
    state.submission.url = 'https://x.com/i/article/123456789';
    expect((await call()).status).toBe(422);
    state.submission = { ...state.submission, url: 'https://x.com/a/status/2027172169336476151', status: 'approved' };
    expect((await call()).status).toBe(409);
    expect(state.ingest).not.toHaveBeenCalled();
  });

  it('only flips a submission that is still pending', async () => {
    expect((await call()).status).toBe(200);
    expect(state.updateFilters).toContainEqual(['status', 'pending']);

    state.lostRace = true;
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/someone else/);
  });
});
