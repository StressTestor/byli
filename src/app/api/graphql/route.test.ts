import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { MAX_GRAPHQL_BODY_BYTES } from '@/graphql/body-limit';

const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock('@/graphql/server', () => ({ createGraphqlServer: () => ({}) }));
vi.mock('@as-integrations/next', () => ({ startServerAndCreateNextHandler: () => mocks.handler }));
import { POST } from './route';

function request(body: string, headers: Record<string, string> = {}) {
  return new NextRequest('https://example.test/api/graphql', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
  });
}

beforeEach(() => {
  mocks.handler.mockReset();
  mocks.handler.mockImplementation(async (req: NextRequest) => Response.json({
    body: await req.json(),
    type: req.headers.get('content-type'),
    auth: req.headers.get('authorization'),
    cookie: req.headers.get('cookie'),
  }));
});

describe('GraphQL POST body guard wiring', () => {
  it('forwards valid bounded JSON and preserves authentication headers', async () => {
    const response = await POST(request('{"query":"{ categories { slug } }"}', {
      'content-type': 'application/json; charset=utf-8',
      authorization: 'Bearer test-only-token', cookie: 'test-session=synthetic',
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      body: { query: '{ categories { slug } }' }, type: 'application/json',
      auth: 'Bearer test-only-token', cookie: 'test-session=synthetic',
    });
    expect(mocks.handler).toHaveBeenCalledTimes(1);
  });

  it('answers oversized bodies with 413 before invoking Apollo', async () => {
    const response = await POST(request(JSON.stringify({ query: 'x'.repeat(MAX_GRAPHQL_BODY_BYTES) })));
    expect(response.status).toBe(413);
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it('answers invalid/batched JSON with 400 and wrong content types with 415', async () => {
    for (const body of ['oops', '[{"query":"{ categories { id } }"}]']) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect((await POST(request('{}', { 'content-type': 'text/plain' }))).status).toBe(415);
    expect(mocks.handler).not.toHaveBeenCalled();
  });
});
