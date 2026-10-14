export const MAX_GRAPHQL_BODY_BYTES = 64 * 1024;

export class GraphqlBodyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// Do not call req.json()/text() before bounding the stream: Content-Length is
// optional and cannot be trusted to describe what the client actually sends.
export async function readGraphqlBody(req: Request): Promise<string> {
  const contentType = req.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new GraphqlBodyError('Use application/json.', 415);
  const declaredSize = req.headers.get('content-length');
  if (declaredSize && Number(declaredSize) > MAX_GRAPHQL_BODY_BYTES) {
    throw new GraphqlBodyError('GraphQL request body is too large.', 413);
  }
  if (!req.body) throw new GraphqlBodyError('A JSON request body is required.', 400);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_GRAPHQL_BODY_BYTES) {
        await reader.cancel();
        throw new GraphqlBodyError('GraphQL request body is too large.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks).toString('utf8');
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Not a single operation');
    }
  } catch {
    throw new GraphqlBodyError('Send a single JSON GraphQL request object.', 400);
  }
  return body;
}
