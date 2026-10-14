import { describe, expect, it } from 'vitest';
import { MAX_GRAPHQL_BODY_BYTES, readGraphqlBody } from './body-limit';

function request(body: string, headers: Record<string, string> = {}) {
  return new Request('https://example.test/api/graphql', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
  });
}

describe('GraphQL HTTP body bounds', () => {
  it('accepts ordinary and charset JSON requests', async () => {
    const body = JSON.stringify({ query: '{ categories { slug } }' });
    expect(await readGraphqlBody(request(body))).toBe(body);
    expect(await readGraphqlBody(request(body, { 'content-type': 'application/json; charset=utf-8' }))).toBe(body);
  });

  it('rejects oversized declared length before reading', async () => {
    const req = request('{}', { 'content-length': String(MAX_GRAPHQL_BODY_BYTES + 1) });
    await expect(readGraphqlBody(req)).rejects.toMatchObject({ status: 413 });
    expect(req.bodyUsed).toBe(false);
  });

  it('bounds actual bytes even with no header or a misleading short length', async () => {
    const body = JSON.stringify({ query: 'x'.repeat(MAX_GRAPHQL_BODY_BYTES) });
    await expect(readGraphqlBody(request(body))).rejects.toMatchObject({ status: 413 });
    await expect(readGraphqlBody(request(body, { 'content-length': '2' }))).rejects.toMatchObject({ status: 413 });
  });

  it('counts UTF-8 bytes instead of characters', async () => {
    const body = JSON.stringify({ query: '🧡'.repeat(MAX_GRAPHQL_BODY_BYTES / 3) });
    expect(body.length).toBeLessThan(MAX_GRAPHQL_BODY_BYTES);
    await expect(readGraphqlBody(request(body))).rejects.toMatchObject({ status: 413 });
  });

  it('cancels a chunked request as soon as it exceeds the limit', async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(40_000)); },
      cancel() { cancelled = true; },
    });
    const req = new Request('https://example.test/api/graphql', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half',
    } as RequestInit);
    await expect(readGraphqlBody(req)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });

  it('rejects batching, malformed JSON, and unsupported content types', async () => {
    for (const body of ['[]', '[{"query":"{ categories { id } }"}]', 'null', 'oops']) {
      await expect(readGraphqlBody(request(body))).rejects.toMatchObject({ status: 400 });
    }
    await expect(readGraphqlBody(request('{}', { 'content-type': 'text/plain' }))).rejects.toMatchObject({ status: 415 });
  });
});
