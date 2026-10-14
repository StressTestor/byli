// This state belongs to a single GraphQL request. Never reuse it between
// requests: viewer data must not survive a change of authenticated user.
export interface GraphqlContext {
  authToken: string | null;
  apiKey: string | null;
  requestCache?: Map<string, unknown>;
}

export function memoizeRequest<T>(
  context: GraphqlContext | undefined,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  if (!context) return load();
  const cache = context.requestCache ??= new Map();
  if (!cache.has(key)) cache.set(key, load());
  return cache.get(key) as Promise<T>;
}

// Coalesce sibling article viewer fields into one bounded IN query per table.
// Keep resolved promises too, so aliases/repeated articles do not repeat reads.
export function batchRequest<T>(
  context: GraphqlContext | undefined,
  key: string,
  id: string,
  load: (ids: string[]) => Promise<Map<string, T>>,
  fallback: T,
): Promise<T> {
  if (!context) return load([id]).then(values => values.get(id) ?? fallback);
  const cache = context.requestCache ??= new Map();
  type Batch = {
    promises: Map<string, Promise<T>>;
    pending: Map<string, { resolve: (value: T) => void; reject: (error: unknown) => void }>;
  };
  let batch = cache.get(key) as Batch | undefined;
  if (!batch) {
    batch = { promises: new Map(), pending: new Map() };
    cache.set(key, batch);
  }
  const known = batch.promises.get(id);
  if (known) return known;
  const current = batch;
  const first = current.pending.size === 0;
  const promise = new Promise<T>((resolve, reject) => current.pending.set(id, { resolve, reject }));
  current.promises.set(id, promise);
  if (first) queueMicrotask(async () => {
    const pending = current.pending;
    current.pending = new Map();
    try {
      const values = await load([...pending.keys()]);
      for (const [articleId, callbacks] of pending) callbacks.resolve(values.get(articleId) ?? fallback);
    } catch (error) {
      for (const callbacks of pending.values()) callbacks.reject(error);
    }
  });
  return promise;
}
