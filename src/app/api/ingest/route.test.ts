import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('@/lib/ingest', () => ({
  runIngestion: (...a: any[]) => state.run(...a),
  ingestSingleArticle: vi.fn(),
  sleep: async () => {},
}));

import { GET, POST, maxDuration } from './route';

const stats = { accounts_checked: 2, new_articles: 1 };
const call = (auth = 'Bearer test-secret') =>
  GET(new Request('http://localhost/api/ingest', { headers: { authorization: auth } }) as any);

beforeEach(() => {
  process.env.CRON_SECRET = 'test-secret';
  state.run = vi.fn(async () => ({ ok: true, result: stats }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/ingest', () => {
  it('declares the Hobby max duration', () => {
    expect(maxDuration).toBe(60);
  });

  it('rejects a missing cron secret without running', async () => {
    expect((await call('Bearer wrong')).status).toBe(401);
    expect(state.run).not.toHaveBeenCalled();
  });

  it('returns 200 with the run stats on success', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(stats);
  });

  it('returns 502 with the upstream error and status on an auth/quota abort', async () => {
    state.run = vi.fn(async () => ({
      ok: false, result: stats, error: 'twitterapi.io /user/last_tweets responded 402', upstreamStatus: 402,
    }));
    const res = await call();
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'twitterapi.io /user/last_tweets responded 402', status: 402 });
  });

  it('returns 500 when the run fails for a non-upstream reason', async () => {
    state.run = vi.fn(async () => ({ ok: false, result: stats, error: 'seed_accounts query failed: boom' }));
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: 'seed_accounts query failed: boom' });
  });
});


describe('cron authentication fails closed', () => {
  it.each([undefined, '', '   '])('rejects absent or empty configured secret (%s) for both methods', async secret => {
    if (secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secret;
    for (const handler of [GET, POST]) {
      for (const authorization of ['Bearer undefined', 'Bearer ', 'Bearer test-secret']) {
        const response = await handler(new Request('http://localhost/api/ingest', {
          method: handler === POST ? 'POST' : 'GET', headers: { authorization },
        }) as any);
        expect(response.status).toBe(401);
      }
    }
    expect(state.run).not.toHaveBeenCalled();
  });
});
