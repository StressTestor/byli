import { describe, it, expect, vi, afterEach } from 'vitest';

const writes = vi.hoisted(() => ({ upsert: vi.fn(), insert: vi.fn() }));

vi.mock('@/lib/supabase-admin', () => {
  const builder: any = {};
  for (const m of ['select', 'eq', 'or']) builder[m] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => Promise.resolve({ data: null }));
  builder.then = (resolve: any) => resolve({ data: [] }); // loadCategoryMap awaits the builder
  builder.upsert = writes.upsert;
  builder.insert = writes.insert;
  return { supabaseAdmin: { from: vi.fn(() => builder) } };
});

import { POST } from './route';

afterEach(() => vi.unstubAllGlobals());

describe('ingestion title blocklist', () => {
  it('skips a blocked manual submission before any database write', async () => {
    process.env.CRON_SECRET = 'test-secret';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'success',
      article: {
        title: 'A retarded take',
        preview_text: 'x',
        contents: [{ text: 'body' }],
        author: { id: '1', userName: 'u', name: 'U', profilePicture: '', isBlueVerified: false, followers: 0 },
        createdAt: '2026-01-01T00:00:00Z',
        likeCount: 0, replyCount: 0, quoteCount: 0, viewCount: 0,
      },
    }))));

    const req = new Request('http://localhost/api/ingest', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret' },
      body: JSON.stringify({ tweet_id: '123' }),
    });
    const res = await POST(req as any);
    const body = await res.json();

    expect(body.ingested[0]).toMatchObject({ tweet_id: '123', ok: false, blocked: true });
    expect(writes.upsert).not.toHaveBeenCalled();
    expect(writes.insert).not.toHaveBeenCalled();
  });
});
